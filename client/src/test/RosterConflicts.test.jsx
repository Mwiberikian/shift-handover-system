// Phase 3: the roster assign dialog warns (never blocks) when a chosen person
// is already assigned to an overlapping shift.
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import api from '../api';
import RosterPage from '../pages/RosterPage';
import { renderWithProviders } from './helpers';

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, default: { get: vi.fn(), post: vi.fn(), put: vi.fn() } };
});

const hours = (h) => new Date(Date.now() + h * 3600e3).toISOString();
const SHIFT = {
  shift_id: 's1', shift_type: 'day', start_time: hours(1), end_time: hours(13), department_id: 'd1', department_name: 'Ground Operations', assigned: [],
};
const OVERLAP = {
  shift_id: 's9', shift_type: 'night', start_time: hours(6), end_time: hours(18), department_name: 'Ground Operations',
};
const ASSIGNMENTS = {
  shift: SHIFT,
  assigned: [],
  candidates: [
    { user_id: 'u1', full_name: 'Achieng Otieno', role: 'outgoing_staff' },
    { user_id: 'u2', full_name: 'Brian Kamau', role: 'incoming_staff' },
  ],
  conflicts: [{ user_id: 'u1', ...OVERLAP }],
};

beforeEach(() => {
  api.get.mockImplementation((url) => {
    if (url === '/shifts') return Promise.resolve({ data: [SHIFT] });
    if (url.endsWith('/assignments')) return Promise.resolve({ data: ASSIGNMENTS });
    return Promise.resolve({ data: {} });
  });
  api.put.mockResolvedValue({ data: { shift: SHIFT, assigned: [], warnings: [] } });
});

describe('roster conflict warnings', () => {
  test('choosing a person on an overlapping shift shows the warning, and saving still works', async () => {
    renderWithProviders(<RosterPage />);
    await userEvent.click(await screen.findByRole('button', { name: /Edit staff/ }));

    // The candidate row already flags the overlap.
    expect(await screen.findByText(/also on an overlapping shift/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('checkbox', { name: /Achieng Otieno/ }));
    expect(await screen.findByText('Overlapping shifts')).toBeInTheDocument();
    expect(screen.getByText(/is also assigned to/)).toBeInTheDocument();
    expect(screen.getByText(/warning, not a block/)).toBeInTheDocument();

    // Saving is never blocked by the warning.
    await userEvent.click(screen.getByRole('button', { name: /Save roster/ }));
    expect(api.put).toHaveBeenCalledWith('/shifts/s1/assignments', { user_ids: ['u1'] });
  });

  test('flag off (the server sends no conflicts): the dialog is exactly as before', async () => {
    const { conflicts, ...offShape } = ASSIGNMENTS; // eslint-disable-line no-unused-vars
    api.get.mockImplementation((url) => {
      if (url === '/shifts') return Promise.resolve({ data: [SHIFT] });
      if (url.endsWith('/assignments')) return Promise.resolve({ data: offShape });
      return Promise.resolve({ data: {} });
    });
    renderWithProviders(<RosterPage />);
    await userEvent.click(await screen.findByRole('button', { name: /Edit staff/ }));
    await userEvent.click(await screen.findByRole('checkbox', { name: /Achieng Otieno/ }));
    expect(screen.queryByText(/also on an overlapping shift/)).not.toBeInTheDocument();
    expect(screen.queryByText('Overlapping shifts')).not.toBeInTheDocument();
  });

  test('a clean candidate raises no warning', async () => {
    renderWithProviders(<RosterPage />);
    await userEvent.click(await screen.findByRole('button', { name: /Edit staff/ }));
    await userEvent.click(await screen.findByRole('checkbox', { name: /Brian Kamau/ }));
    expect(screen.queryByText('Overlapping shifts')).not.toBeInTheDocument();
  });
});
