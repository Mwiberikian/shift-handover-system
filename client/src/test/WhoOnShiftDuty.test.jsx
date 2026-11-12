// Phase 3: the "Who is on shift" card labels the roster with duty chips
// ("Outgoing now" / "Incoming next") while roster duty is on.
import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import api from '../api';
import WhoOnShift from '../components/WhoOnShift';
import useRosterDuty, { resetRosterDutyCache } from '../lib/useRosterDuty';
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
    assignees: [{ full_name: 'Achieng Otieno', staff_number: 'KQ100' }],
  },
  next: {
    shift_id: 's2', shift_type: 'night', start_time: hours(8), end_time: hours(20), department_name: 'Ground Operations',
    assignees: [{ full_name: 'Brian Kamau', staff_number: 'KQ200' }],
  },
};

// The server adds `roster_duty: true` to this response only when the flag is on.
const mockApi = (dutyEnabled) => api.get.mockImplementation(() => Promise.resolve({
  data: dutyEnabled ? { ...SHIFTS, roster_duty: true } : SHIFTS,
}));

beforeEach(() => resetRosterDutyCache());

describe('WhoOnShift duty chips', () => {
  test('duty on: the current roster is "Outgoing now" and the next is "Incoming next"', async () => {
    mockApi(true);
    renderWithProviders(<WhoOnShift />);
    expect(await screen.findByText('Outgoing now')).toBeInTheDocument();
    expect(await screen.findByText('Incoming next')).toBeInTheDocument();
    expect(screen.getByText('Achieng Otieno')).toBeInTheDocument();
    expect(screen.getByText('Brian Kamau')).toBeInTheDocument();
  });

  test('duty off: the card looks exactly as before, with no duty chips', async () => {
    mockApi(false);
    renderWithProviders(<WhoOnShift />);
    expect(await screen.findByText('Who is on shift')).toBeInTheDocument();
    expect(screen.queryByText('Outgoing now')).not.toBeInTheDocument();
    expect(screen.queryByText('Incoming next')).not.toBeInTheDocument();
  });

  test("duty off: the headings are main's markup exactly, and no duty config request is made", async () => {
    mockApi(false);
    renderWithProviders(<WhoOnShift />);
    await screen.findByText('Who is on shift');
    const headings = screen.getAllByRole('heading', { level: 3 });
    expect(headings).toHaveLength(2);
    headings.forEach((h) => {
      expect(h.className).toBe('text-meta font-semibold tracking-wide text-ink-600 uppercase');
      expect(h.children).toHaveLength(0); // plain text: no wrapping span, no chip
    });
    expect(headings[0].textContent).toMatch(/^On now · /);
    expect(api.get.mock.calls.map(([url]) => url)).toEqual(['/shifts/department/current']);
  });

  test('duty on: the card tells the rest of the app, without a separate request', async () => {
    mockApi(true);
    function Probe() { return <p>{useRosterDuty().enabled ? 'nav: on' : 'nav: off'}</p>; }
    renderWithProviders(<><WhoOnShift /><Probe /></>);
    expect(await screen.findByText('nav: on')).toBeInTheDocument();
    expect(api.get.mock.calls.map(([url]) => url)).not.toContain('/shifts/duty/config');
  });
});
