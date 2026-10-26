import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import api from '../api';
import DraftAssistant from '../components/assistant/DraftAssistant';
import SeverityHint from '../components/assistant/SeverityHint';
import { AttentionList, MeaningSearch } from '../components/assistant/OversightPanels';
import { useAssistantEnabled } from '../components/assistant/useAssistant';

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } };
});

const record = { record_id: 'rec-1' };
const answer = (map) => api.get.mockImplementation(async (url) => {
  const hit = Object.entries(map).find(([k]) => url.endsWith(k));
  if (!hit) throw new Error('404');
  return { data: hit[1] };
});

beforeEach(() => {
  vi.resetAllMocks();
  api.post.mockResolvedValue({ data: { ok: true } });
});

function Probe() {
  return <p>{useAssistantEnabled() ? 'on' : 'off'}</p>;
}

describe('assistant config', () => {
  test('on only when the server says so', async () => {
    answer({ '/assistant/config': { enabled: true } });
    render(<Probe />);
    expect(await screen.findByText('on')).toBeInTheDocument();
  });
  test('off when the server is off or fails', async () => {
    api.get.mockRejectedValue(new Error('x'));
    render(<Probe />);
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(screen.getByText('off')).toBeInTheDocument();
  });
});

describe('DraftAssistant', () => {
  const data = {
    check: { flags: [{ code: 'task_vague', level: 'low', message: 'Task 1 is vague.', ref: { kind: 'task', index: 0 } }] },
    recurring: { recurring: [{ id: 'a', text: 'GPU fault stand 5', matches: [{ record_id: 'r0', text: 'GPU fault stand 5', shift_start: '2026-10-20T05:00:00Z' }] }] },
    suggestions: { suggestions: [{ id: 's1', text: 'Check fuel bowser log', priority: 'medium', support: 4, of: 6 }] },
  };

  test('shows flags, recurring items and suggestions', async () => {
    answer(data);
    render(<DraftAssistant record={record} version="1" reload={vi.fn()} />);
    expect(await screen.findByText('Task 1 is vague.')).toBeInTheDocument();
    expect(screen.getByText(/looks like 1 earlier item/i)).toBeInTheDocument();
    expect(screen.getByText('Check fuel bowser log')).toBeInTheDocument();
    expect(screen.getByText(/in 4 of your last 6/i)).toBeInTheDocument();
  });

  test('dismissing a flag hides it and logs the choice', async () => {
    answer(data);
    const user = userEvent.setup();
    render(<DraftAssistant record={record} version="1" reload={vi.fn()} />);
    await user.click(await screen.findByRole('button', { name: /dismiss: task 1 is vague/i }));
    expect(screen.queryByText('Task 1 is vague.')).not.toBeInTheDocument();
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/assistant/events', expect.objectContaining({ kind: 'flag_dismissed' })));
  });

  test('accepting a suggestion adds the task and reloads; nothing is added before that', async () => {
    answer(data);
    const reload = vi.fn();
    const user = userEvent.setup();
    render(<DraftAssistant record={record} version="1" reload={reload} />);
    await screen.findByText('Check fuel bowser log');
    expect(api.post).not.toHaveBeenCalledWith('/handovers/rec-1/tasks', expect.anything());
    await user.click(screen.getByRole('button', { name: /add task: check fuel bowser log/i }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/handovers/rec-1/tasks', { description: 'Check fuel bowser log', priority: 'medium' }));
    expect(reload).toHaveBeenCalled();
  });

  test('says so when there is nothing to report, and renders nothing if every call fails', async () => {
    answer({ check: { flags: [] }, recurring: { recurring: [] }, suggestions: { suggestions: [] } });
    const { unmount } = render(<DraftAssistant record={record} version="1" reload={vi.fn()} />);
    expect(await screen.findByText(/no problems found/i)).toBeInTheDocument();
    unmount();
    api.get.mockRejectedValue(new Error('x'));
    const { container } = render(<DraftAssistant record={record} version="2" reload={vi.fn()} />);
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});

describe('SeverityHint', () => {
  test('suggests a severity with reasons and applies it only on click', async () => {
    api.post.mockImplementation(async (url) => ({ data: url.endsWith('/severity') ? { available: true, severity: 'high', confidence: 0.8, top_terms: ['smoke'] } : { ok: true } }));
    const onUse = vi.fn();
    const user = userEvent.setup();
    render(<SeverityHint title="Smoke in the hold" description="" current="low" onUse={onUse} recordId="rec-1" />);
    expect(await screen.findByText(/usually/i, {}, { timeout: 3000 })).toHaveTextContent(/high.*80% sure.*smoke/i);
    expect(onUse).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /use high/i }));
    expect(onUse).toHaveBeenCalledWith('high');
  });

  test('stays hidden when the model is unavailable', async () => {
    api.post.mockResolvedValue({ data: { available: false, reason: 'Needs more history' } });
    const { container } = render(<SeverityHint title="Smoke in the hold" description="" current="low" onUse={vi.fn()} />);
    await waitFor(() => expect(api.post).toHaveBeenCalled(), { timeout: 3000 });
    expect(container).toBeEmptyDOMElement();
  });
});

describe('supervisor panels', () => {
  test('attention list shows the score and the reasons behind it', async () => {
    answer({ '/assistant/attention': { items: [{
      record_id: 'r1', department_name: 'Ground Ops', shift_type: 'night', shift_start: '2026-10-20T20:00:00Z', outgoing_name: 'Omar',
      level: 'high', score: 72, reasons: [{ code: 'x', points: 30, text: 'A critical incident' }], flags: [],
    }] } });
    const onOpen = vi.fn();
    const user = userEvent.setup();
    render(<AttentionList onOpen={onOpen} />);
    expect(await screen.findByText(/high · 72/i)).toBeInTheDocument();
    expect(screen.getByText(/a critical incident \(\+30\)/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /ground ops/i }));
    expect(onOpen).toHaveBeenCalledWith('r1');
  });

  test('meaning search shows matches with their snippet', async () => {
    answer({ '/assistant/search': { results: [{ record_id: 'r2', department_name: 'Ground Ops', shift_type: 'day', shift_start: '2026-10-19T05:00:00Z', score: 0.62, snippet: { kind: 'task', text: 'Ground power unit stand 5 tripping' } }] } });
    const user = userEvent.setup();
    render(<MeaningSearch onOpen={vi.fn()} />);
    await user.type(screen.getByLabelText(/describe what you are looking for/i), 'GPU fault');
    await user.click(screen.getByRole('button', { name: /find/i }));
    expect(await screen.findByText(/ground power unit stand 5 tripping/i)).toBeInTheDocument();
    expect(screen.getByText(/match 62%/i)).toBeInTheDocument();
  });
});
