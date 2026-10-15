// Part M4: the supervisor live board page - workers and their states, the
// totals, the status filter, the admin department switcher and the worker
// detail drawer.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import api, { tokenStore } from '../api';
import LivePage from '../pages/LivePage';
import { NAV, tabsFor } from '../components/shell/nav';
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
  workers: [
    worker('1', 'Achieng Otieno', 'working', {
      session: { started_at: ago(65), ended_at: null, elapsed_ms: 65 * 60000 },
      current_task: { task_id: 't1', description: 'Check GPU on stand 3', timer_started_at: ago(5), elapsed_ms: 5 * 60000 },
      tasks: { open: 2, in_progress: 1, resolved: 3 }, incident_count: 1, last_activity_at: ago(1),
    }),
    worker('2', 'Collins Ouma', 'idle', { session: { started_at: ago(30), ended_at: null, elapsed_ms: 30 * 60000 } }),
    worker('3', 'Nancy Moraa', 'not_started'),
  ],
  totals: {
    workers: 3, working: 1, idle: 1, not_started: 1, ended: 0, handover_submitted: 0, open: 2, in_progress: 1, resolved: 3, incidents: 1,
  },
};

beforeEach(() => vi.clearAllMocks());

test('the supervisor tab bar and both sidebars reach the live board', () => {
  expect(tabsFor('supervisor').map((t) => t.to)).toContain('/supervisor/live');
  expect(NAV.supervisor.some((i) => i.to === '/supervisor/live')).toBe(true);
  expect(NAV.admin.some((i) => i.to === '/admin/live')).toBe(true);
});

describe('live board', () => {
  test('shows each worker with state, ticking session and task timers, counts and totals', async () => {
    tokenStore.set(fakeToken('supervisor'));
    api.get.mockResolvedValue({ data: BOARD });
    renderWithProviders(<LivePage />);

    const row = (await screen.findByText('Achieng Otieno')).closest('tr');
    expect(within(row).getByText('Working')).toBeInTheDocument();
    expect(within(row).getByText(/^1:0[45]:\d\d$/)).toBeInTheDocument(); // session, from started_at
    expect(within(row).getByText('Check GPU on stand 3')).toBeInTheDocument();
    expect(within(row).getByText(/^[45]:\d\d$/)).toBeInTheDocument(); // task timer
    expect(within(row).getByText('2 open · 1 in progress · 3 resolved')).toBeInTheDocument();
    expect(within(screen.getByText('Collins Ouma').closest('tr')).getByText('Idle')).toBeInTheDocument();
    expect(within(screen.getByText('Nancy Moraa').closest('tr')).getByText('Not started')).toBeInTheDocument();

    const totals = screen.getByLabelText('Department totals');
    expect(within(totals).getByText('On the roster').nextSibling).toHaveTextContent('3');
    expect(within(totals).getByText('Tasks open / in progress / resolved').nextSibling).toHaveTextContent('2 / 1 / 3');
    expect(api.get).toHaveBeenCalledWith('/supervisor/live', { params: {} });
    expect(screen.queryByLabelText('Department')).not.toBeInTheDocument();
  });

  test('the status filter narrows the table', async () => {
    tokenStore.set(fakeToken('supervisor'));
    api.get.mockResolvedValue({ data: BOARD });
    const user = userEvent.setup();
    renderWithProviders(<LivePage />);
    await screen.findByText('Achieng Otieno');
    await user.click(screen.getByRole('radio', { name: 'Idle (1)' }));
    expect(screen.queryByText('Achieng Otieno')).not.toBeInTheDocument();
    expect(screen.getByText('Collins Ouma')).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Ended (0)' }));
    expect(screen.getByText('No worker is in this state.')).toBeInTheDocument();
  });

  test('admins switch department', async () => {
    tokenStore.set(fakeToken('admin', { department_id: null }));
    const departments = [{ department_id: 'd1', name: 'Ground Operations' }, { department_id: 'd2', name: 'Customer Service' }];
    api.get.mockResolvedValue({ data: { ...BOARD, departments } });
    const user = userEvent.setup();
    renderWithProviders(<LivePage />);
    const select = await screen.findByLabelText('Department');
    await user.selectOptions(select, 'd2');
    await waitFor(() => expect(api.get).toHaveBeenLastCalledWith('/supervisor/live', { params: { department_id: 'd2' } }));
  });

  test('a row opens the worker detail: tasks with time spent and the timeline', async () => {
    tokenStore.set(fakeToken('supervisor'));
    api.get.mockImplementation((url) => Promise.resolve({
      data: url === '/supervisor/live' ? BOARD : {
        server_now: NOW,
        worker: { user_id: '1', full_name: 'Achieng Otieno', staff_number: 'KQ1001', role: 'outgoing_staff', department_name: 'Ground Operations' },
        shift: BOARD.shift,
        tasks: [{ task_id: 't1', description: 'Check GPU on stand 3', status: 'in_progress', total_ms: 25 * 60000, timers: 2, running: false }],
        timeline: [{ at: ago(65), kind: 'session_start', label: 'Started shift' }, { at: ago(5), kind: 'timer_start', label: 'Started timing: Check GPU on stand 3' }],
      },
    }));
    const user = userEvent.setup();
    renderWithProviders(<LivePage />);
    await user.click(await screen.findByRole('row', { name: /Achieng Otieno, Working. Open details/ }));
    const drawer = await screen.findByRole('dialog');
    expect(await within(drawer).findByText('Achieng Otieno (KQ1001)')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/supervisor/live/1');
    expect(within(drawer).getByText('25 min')).toBeInTheDocument();
    expect(within(drawer).getByText('Started shift')).toBeInTheDocument();
    expect(within(drawer).getByText('Started timing: Check GPU on stand 3')).toBeInTheDocument();
  });
});
