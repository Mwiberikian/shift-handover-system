// Part K: "Add to Google Calendar" builds Google's TEMPLATE link in Nairobi
// time; "Download .ics" asks the API for one shift or the next 30 days.
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import api, { tokenStore } from '../api';
import { googleCalendarUrl } from '../lib/calendar';
import MyShiftsPage from '../pages/MyShiftsPage';
import { fakeToken, renderWithProviders } from './helpers';

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } };
});

const SHIFT = {
  shift_id: 'aaaaaaaa-0000-4000-8000-000000000001', shift_type: 'night', start_time: '2026-10-13T15:00:00Z', end_time: '2026-10-14T03:00:00Z',
  department_name: 'Ground Operations',
};

describe('Google Calendar link', () => {
  const ORIGINAL_TZ = process.env.TZ;
  beforeAll(() => { process.env.TZ = 'America/New_York'; });
  afterAll(() => { process.env.TZ = ORIGINAL_TZ; });

  test('TEMPLATE link with title, Nairobi start and end, department; same in any browser zone', () => {
    const url = new URL(googleCalendarUrl(SHIFT));
    expect(url.origin + url.pathname).toBe('https://calendar.google.com/calendar/render');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      action: 'TEMPLATE',
      text: 'Night shift - Ground Operations',
      dates: '20261013T180000/20261014T060000',
      ctz: 'Africa/Nairobi',
      details: 'Night shift, Ground Operations. From Shift Handover.',
      location: 'Ground Operations',
    });
  });
});

describe('My shifts page', () => {
  test('lists the next 30 days with a Google link and .ics downloads', async () => {
    tokenStore.set(fakeToken('outgoing_staff'));
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:x');
    globalThis.URL.revokeObjectURL = vi.fn();
    api.get.mockImplementation((url) => (url === '/shifts/mine/upcoming'
      ? Promise.resolve({ data: [SHIFT] })
      : Promise.resolve({ data: new Blob(['BEGIN:VCALENDAR']), headers: { 'content-disposition': 'attachment; filename="x.ics"' } })));
    const user = userEvent.setup();
    renderWithProviders(<MyShiftsPage />);

    const row = (await screen.findByText('Night shift')).closest('tr');
    expect(within(row).getByText(/2026-10-13 · 18:00 EAT – 06:00 EAT/)).toBeInTheDocument();
    const link = within(row).getByRole('link', { name: /add night shift 2026-10-13 to google calendar/i });
    expect(link).toHaveAttribute('href', googleCalendarUrl(SHIFT));
    expect(link).toHaveAttribute('target', '_blank');

    await user.click(within(row).getByRole('button', { name: /download night shift 2026-10-13 as an \.ics file/i }));
    expect(api.get).toHaveBeenCalledWith('/shifts/calendar.ics', { params: { shift_id: SHIFT.shift_id }, responseType: 'blob' });

    await user.click(screen.getByRole('button', { name: 'Download .ics (next 30 days)' }));
    expect(api.get).toHaveBeenCalledWith('/shifts/calendar.ics', { params: { days: 30, scope: 'mine' }, responseType: 'blob' });
  });

  test('says so when nothing is rostered', async () => {
    tokenStore.set(fakeToken('incoming_staff'));
    api.get.mockResolvedValue({ data: [] });
    renderWithProviders(<MyShiftsPage />);
    expect(await screen.findByText('No shifts rostered')).toBeInTheDocument();
  });
});
