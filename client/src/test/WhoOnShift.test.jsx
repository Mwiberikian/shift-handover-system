// Phase 1 roster visibility: the "Who is on shift" card (names and staff
// numbers of the department's current and next shift).
import { screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import api from '../api';
import WhoOnShift from '../components/WhoOnShift';
import { renderWithProviders } from './helpers';

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, default: { get: vi.fn(), post: vi.fn() } };
});

const hours = (h) => new Date(Date.now() + h * 3600e3).toISOString();
const SHIFTS = {
  now: new Date().toISOString(),
  current: {
    shift_id: 's1', shift_type: 'day', start_time: hours(-4), end_time: hours(8), department_name: 'Ground Operations',
    assignees: [{ full_name: 'Achieng Otieno', staff_number: 'KQ100' }, { full_name: 'Collins Ouma', staff_number: 'KQ200' }],
  },
  next: {
    shift_id: 's2', shift_type: 'night', start_time: hours(8), end_time: hours(20), department_name: 'Ground Operations',
    assignees: [],
  },
};

beforeEach(() => vi.clearAllMocks());

describe('Who is on shift card', () => {
  test('shows names and staff numbers for the current and next shift', async () => {
    api.get.mockResolvedValue({ data: SHIFTS });
    renderWithProviders(<WhoOnShift />);
    expect(await screen.findByText('Who is on shift')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/shifts/department/current');
    expect(screen.getByText('Achieng Otieno')).toBeInTheDocument();
    expect(screen.getByText('· KQ100')).toBeInTheDocument();
    expect(screen.getByText('· KQ200')).toBeInTheDocument();
    expect(screen.getByText(/On now/)).toBeInTheDocument();
    expect(screen.getByText(/Next/)).toBeInTheDocument();
    expect(screen.getByText('Nobody assigned yet.')).toBeInTheDocument();
  });

  test('renders nothing when the endpoint is off (404) or there are no shifts', async () => {
    api.get.mockRejectedValue({ response: { status: 404 } });
    const { container } = renderWithProviders(<WhoOnShift />);
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();

    api.get.mockResolvedValue({ data: { now: new Date().toISOString(), current: null, next: null } });
    const { container: empty } = renderWithProviders(<WhoOnShift />);
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
    expect(empty).toBeEmptyDOMElement();
  });
});
