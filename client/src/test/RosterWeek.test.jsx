// Phase 1 roster visibility: the Roster page lists shifts by day, a week at
// a time, with Previous / This week / Next navigation over the existing
// GET /shifts?from&to route.
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import api, { tokenStore } from '../api';
import RosterPage, { weekStartEAT } from '../pages/RosterPage';
import { fakeToken, renderWithProviders } from './helpers';

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, default: { get: vi.fn(), put: vi.fn(), post: vi.fn() } };
});

const DAY = 24 * 3600e3;
const weekStart = weekStartEAT(new Date());
const at = (days, hours) => new Date(weekStart.getTime() + days * DAY + hours * 3600e3).toISOString();
const SHIFTS = [
  {
    shift_id: 's1', shift_type: 'day', start_time: at(0, 6), end_time: at(0, 18),
    department_id: 'd1', department_name: 'Ground Operations', assigned: [{ user_id: 'u1', full_name: 'Achieng Otieno', role: 'outgoing_staff' }],
  },
  {
    shift_id: 's2', shift_type: 'night', start_time: at(2, 18), end_time: at(3, 6),
    department_id: 'd1', department_name: 'Ground Operations', assigned: [],
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  tokenStore.set(fakeToken('supervisor'));
  api.get.mockResolvedValue({ data: SHIFTS });
});

test('loads this week by day: one section per day with its shifts and assignees', async () => {
  renderWithProviders(<RosterPage />);
  expect(await screen.findByText('Achieng Otieno')).toBeInTheDocument();
  expect(api.get).toHaveBeenCalledWith('/shifts', {
    params: { from: weekStart.toISOString(), to: new Date(weekStart.getTime() + 7 * DAY).toISOString() },
  });
  // Two shifts on two different days give two day sections.
  const headings = screen.getAllByRole('heading', { level: 2 });
  expect(headings).toHaveLength(2);
  expect(screen.getByText('Nobody assigned')).toBeInTheDocument();
});

test('Previous and Next move a week; This week returns to the current one', async () => {
  const user = userEvent.setup();
  renderWithProviders(<RosterPage />);
  await screen.findByText('Achieng Otieno');

  await user.click(screen.getByRole('button', { name: 'Next week' }));
  const nextStart = new Date(weekStart.getTime() + 7 * DAY);
  await waitFor(() => expect(api.get).toHaveBeenLastCalledWith('/shifts', {
    params: { from: nextStart.toISOString(), to: new Date(nextStart.getTime() + 7 * DAY).toISOString() },
  }));

  await user.click(screen.getByRole('button', { name: 'Previous week' }));
  await waitFor(() => expect(api.get).toHaveBeenLastCalledWith('/shifts', {
    params: { from: weekStart.toISOString(), to: new Date(weekStart.getTime() + 7 * DAY).toISOString() },
  }));

  await user.click(screen.getByRole('button', { name: 'Next week' }));
  await user.click(screen.getByRole('button', { name: 'This week' }));
  await waitFor(() => expect(api.get).toHaveBeenLastCalledWith('/shifts', {
    params: { from: weekStart.toISOString(), to: new Date(weekStart.getTime() + 7 * DAY).toISOString() },
  }));
  expect(screen.getByRole('button', { name: 'This week' })).toBeDisabled();
});

test('a week without shifts shows the empty state', async () => {
  api.get.mockResolvedValue({ data: [] });
  renderWithProviders(<RosterPage />);
  expect(await screen.findByText('No shifts this week')).toBeInTheDocument();
});
