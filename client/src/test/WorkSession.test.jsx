// Part M5: the worker's session controls - the notice on first use, Start and
// End shift, the header clock, the 60 s heartbeat while the tab is visible,
// per-task timers, My work and the Help page.
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  afterEach, beforeEach, describe, expect, test, vi,
} from 'vitest';
import api, { tokenStore } from '../api';
import { HeaderSessionControl, TaskTimerButton } from '../components/work/SessionControls';
import MyWorkPage from '../pages/MyWorkPage';
import Help from '../pages/Help';
import { HEARTBEAT_MS, SESSION_NOTICE, WorkSessionProvider } from '../lib/workSession';
import { fakeToken, renderWithProviders } from './helpers';

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } };
});

const ago = (mins) => new Date(Date.now() - mins * 60000).toISOString();
const SESSION = {
  session_id: 's1', started_at: ago(62), shift_type: 'day', shift_start: ago(120), department_name: 'Ground Operations', ended_at: null, elapsed_ms: 62 * 60000,
};
// What start, end, heartbeat and the timer calls return (no history).
const state = (extra = {}) => ({
  server_now: new Date().toISOString(), session: null, timer: null, ...extra,
});
const TASK = { task_id: 't1', description: 'Check GPU on stand 3' };

const withSession = (ui) => <WorkSessionProvider enabled>{ui}</WorkSessionProvider>;

// A fake server: GET /sessions/mine answers with the current state, and
// start/end/timer calls change it (like the real API).
function serve(initial = state()) {
  let current = initial;
  api.get.mockImplementation((url) => Promise.resolve({ data: url === '/sessions/mine' ? { history: [], ...current } : {} }));
  api.post.mockImplementation((url) => {
    if (url === '/sessions/start') current = state({ session: SESSION });
    if (url === '/sessions/end') current = state();
    if (url.endsWith('/timer/start')) current = state({ session: SESSION, timer: { task_id: 't1', description: TASK.description, started_at: ago(3) } });
    if (url.endsWith('/timer/stop')) current = state({ session: SESSION });
    return Promise.resolve({ data: current });
  });
}

let hidden = false;
beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  tokenStore.set(fakeToken('outgoing_staff'));
  hidden = false;
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
});
afterEach(() => vi.useRealTimers());

describe('Start shift', () => {
  test('the first time shows the notice; accepting starts the session; later starts do not ask again', async () => {
    serve();
    const user = userEvent.setup();
    renderWithProviders(withSession(<HeaderSessionControl />));

    await user.click(await screen.findByRole('button', { name: 'Start shift' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(SESSION_NOTICE)).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Start shift' }));
    expect(api.post).toHaveBeenCalledWith('/sessions/start');
    expect(localStorage.getItem('shms.sessionNoticeSeen')).toBe('1');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    // The header now shows the running clock and End shift.
    expect(await screen.findByRole('link', { name: /On shift for 1:0[12]:\d\d\. Open My work/ })).toHaveAttribute('href', '/work');

    await user.click(screen.getByRole('button', { name: 'End shift' }));
    expect(api.post).toHaveBeenCalledWith('/sessions/end');
    await screen.findByRole('button', { name: 'Start shift' });
    await user.click(screen.getByRole('button', { name: 'Start shift' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(api.post.mock.calls.filter(([url]) => url === '/sessions/start')).toHaveLength(2));
  });

  test('a 409 (not rostered now) is shown and nothing starts', async () => {
    localStorage.setItem('shms.sessionNoticeSeen', '1');
    api.get.mockResolvedValue({ data: state() });
    api.post.mockRejectedValue({ response: { status: 409, data: { error: 'You are not on the roster for a shift that is on now' } } });
    const user = userEvent.setup();
    renderWithProviders(withSession(<HeaderSessionControl />));
    await user.click(await screen.findByRole('button', { name: 'Start shift' }));
    expect(api.post).toHaveBeenCalledWith('/sessions/start');
    expect(screen.getByRole('button', { name: 'Start shift' })).toBeInTheDocument();
  });

  test('supervisors and admins get no session controls', () => {
    serve();
    renderWithProviders(<WorkSessionProvider enabled={false}><HeaderSessionControl /><TaskTimerButton task={TASK} /></WorkSessionProvider>);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalledWith('/sessions/mine');
  });
});

describe('heartbeat', () => {
  test('every 60 s while a session runs and the tab is visible; none while hidden', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'] });
    api.get.mockResolvedValue({ data: state({ session: SESSION }) });
    api.post.mockResolvedValue({ data: state({ session: SESSION }) });
    renderWithProviders(withSession(<HeaderSessionControl />));
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    const beats = () => api.post.mock.calls.filter(([url]) => url === '/sessions/heartbeat').length;
    const first = beats(); // one as soon as the session is known
    expect(first).toBe(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(HEARTBEAT_MS); });
    expect(beats()).toBe(2);

    hidden = true;
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    await act(async () => { await vi.advanceTimersByTimeAsync(5 * HEARTBEAT_MS); });
    expect(beats()).toBe(2);

    hidden = false;
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(beats()).toBe(3); // at once on return
  });

  test('without a session no heartbeat is sent', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'] });
    api.get.mockResolvedValue({ data: state() });
    renderWithProviders(withSession(<HeaderSessionControl />));
    await act(async () => { await vi.advanceTimersByTimeAsync(3 * HEARTBEAT_MS); });
    expect(api.post).not.toHaveBeenCalled();
  });
});

describe('task timers', () => {
  test('disabled before the shift starts', async () => {
    api.get.mockResolvedValue({ data: state() });
    renderWithProviders(withSession(<TaskTimerButton task={TASK} />));
    await waitFor(() => expect(screen.getByRole('button', { name: /start your shift first/ })).toBeDisabled());
  });

  test('start, then the running timer shows its time and stops on click', async () => {
    serve(state({ session: SESSION }));
    const user = userEvent.setup();
    renderWithProviders(withSession(<TaskTimerButton task={TASK} />));
    await user.click(await screen.findByRole('button', { name: 'Start timing “Check GPU on stand 3”' }));
    expect(api.post).toHaveBeenCalledWith('/tasks/t1/timer/start');
    const stop = await screen.findByRole('button', { name: /Stop timing “Check GPU on stand 3”, 3:0\d so far/ });
    expect(stop).toHaveTextContent(/^3:0\d$/);
    await user.click(stop);
    expect(api.post).toHaveBeenCalledWith('/tasks/t1/timer/stop');
  });
});

describe('My work and Help', () => {
  test('My work shows the notice, the running session and the history with time per task', async () => {
    api.get.mockResolvedValue({
      data: state({
        session: SESSION,
        history: [
          { ...SESSION },
          {
            session_id: 's0', started_at: ago(26 * 60), ended_at: ago(15 * 60), end_reason: 'heartbeat', elapsed_ms: 11 * 3600000, shift_type: 'night', shift_start: ago(26 * 60),
            tasks: [{ task_id: 't9', description: 'Reconcile the baggage count', total_ms: 50 * 60000 }],
          },
        ].map((s) => ({ tasks: [], ...s })),
      }),
    });
    renderWithProviders(withSession(<MyWorkPage />));
    expect(screen.getByText(SESSION_NOTICE)).toBeInTheDocument();
    expect(await screen.findByText('Timed out (app closed)')).toBeInTheDocument();
    expect(screen.getByText('11 h')).toBeInTheDocument();
    expect(screen.getByText('50 min')).toBeInTheDocument();
    expect(screen.getByText(/Reconcile the baggage count/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'End shift' })).toBeInTheDocument();
  });

  test('Help states the notice and what is stored', () => {
    tokenStore.clear?.();
    renderWithProviders(<Help />);
    const card = document.getElementById('work-sessions');
    expect(within(card).getByText(SESSION_NOTICE)).toBeInTheDocument();
    expect(card).toHaveTextContent('no screen, keystroke, location or camera data');
    expect(card).toHaveTextContent('kept indefinitely');
  });
});
