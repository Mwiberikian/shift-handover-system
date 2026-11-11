// Phase 1 supervisor controls on the live board: Start/End session buttons
// with their confirmation dialogs, hidden while the server reports controls
// disabled.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import api, { tokenStore } from '../api';
import LivePage from '../pages/LivePage';
import { fakeToken, renderWithProviders } from './helpers';

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } };
});

const NOW = new Date().toISOString();
const ago = (mins) => new Date(Date.now() - mins * 60000).toISOString();
const worker = (id, name, state, extra = {}) => ({
  user_id: id, full_name: name, staff_number: `KQ${id}`, role: 'outgoing_staff', state,
  session: null, current_task: null, tasks: { open: 0, in_progress: 0, resolved: 0 }, incident_count: 0, last_activity_at: null, ...extra,
});
const BOARD = {
  server_now: NOW,
  department: { department_id: 'd1', name: 'Ground Operations', code: 'ground_ops' },
  shift: { shift_id: 's1', shift_type: 'day', start_time: ago(200), end_time: new Date(Date.now() + 520 * 60000).toISOString() },
  idle_after_minutes: 2,
  controls_enabled: true,
  workers: [
    worker('1', 'Achieng Otieno', 'working', { session: { started_at: ago(65), ended_at: null, elapsed_ms: 65 * 60000 } }),
    worker('3', 'Nancy Moraa', 'not_started'),
  ],
  totals: {
    workers: 2, working: 1, idle: 0, not_started: 1, ended: 0, handover_submitted: 0, open: 0, in_progress: 0, resolved: 0, incidents: 0,
  },
};
beforeEach(() => {
  vi.clearAllMocks();
  tokenStore.set(fakeToken('supervisor'));
  api.post.mockResolvedValue({ data: {} });
});

describe('start and end session buttons', () => {
  test('End for a running session, Start otherwise; confirming Start posts and reloads the board', async () => {
    api.get.mockResolvedValue({ data: BOARD });
    const user = userEvent.setup();
    renderWithProviders(<LivePage />);

    await screen.findByText('Achieng Otieno');
    expect(screen.getByRole('button', { name: 'End session for Achieng Otieno' })).toBeInTheDocument();
    const boardCalls = api.get.mock.calls.length;

    await user.click(screen.getByRole('button', { name: 'Start session for Nancy Moraa' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Start a work session for Nancy Moraa/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Start session' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/supervisor/live/3/session/start'));
    await waitFor(() => expect(api.get.mock.calls.length).toBeGreaterThan(boardCalls)); // board reloads
  });

  test('confirming End posts to the end route', async () => {
    api.get.mockResolvedValue({ data: BOARD });
    const user = userEvent.setup();
    renderWithProviders(<LivePage />);

    await user.click(await screen.findByRole('button', { name: 'End session for Achieng Otieno' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'End session' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/supervisor/live/1/session/end'));
  });

  test('Cancel closes the dialog without posting', async () => {
    api.get.mockResolvedValue({ data: BOARD });
    const user = userEvent.setup();
    renderWithProviders(<LivePage />);

    await user.click(await screen.findByRole('button', { name: 'Start session for Nancy Moraa' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(api.post).not.toHaveBeenCalled();
  });

  test('hidden while the server reports controls disabled (flag off)', async () => {
    api.get.mockResolvedValue({ data: { ...BOARD, controls_enabled: false } });
    renderWithProviders(<LivePage />);
    await screen.findByText('Achieng Otieno');
    expect(screen.queryByRole('button', { name: /session for/ })).not.toBeInTheDocument();
  });
});
