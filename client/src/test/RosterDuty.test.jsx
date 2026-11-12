// Phase 3: roster-derived duty on the client — staff areas open to both staff
// roles only while the server reports ROSTER_DUTY_ENABLED, and the sidebar
// gains the other staff area's handover links.
import { screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import api, { tokenStore } from '../api';
import { RequireRole } from '../App';
import { NAV, navFor } from '../components/shell/nav';
import { resetRosterDutyCache } from '../lib/useRosterDuty';
import { fakeToken, renderWithProviders } from './helpers';

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, default: { get: vi.fn(), post: vi.fn() } };
});

beforeEach(() => resetRosterDutyCache());

const dutyConfig = (enabled) => api.get.mockImplementation((url) => (url === '/shifts/duty/config'
  ? Promise.resolve({ data: { enabled } })
  : Promise.resolve({ data: {} })));

function renderAt(route) {
  return renderWithProviders(
    <Routes>
      <Route path="/outgoing" element={<RequireRole role="outgoing_staff" />}>
        <Route index element={<p>outgoing dashboard</p>} />
      </Route>
      <Route path="/incoming" element={<RequireRole role="incoming_staff" />}>
        <Route index element={<p>incoming dashboard</p>} />
      </Route>
    </Routes>,
    { route },
  );
}

describe('RequireRole with roster duty', () => {
  test('duty on: an incoming-role person may open the outgoing area (and the reverse)', async () => {
    dutyConfig(true);
    tokenStore.set(fakeToken('incoming_staff'));
    renderAt('/outgoing');
    expect(await screen.findByText('outgoing dashboard')).toBeInTheDocument();

    tokenStore.set(fakeToken('outgoing_staff'));
    renderAt('/incoming');
    expect(await screen.findByText('incoming dashboard')).toBeInTheDocument();
  });

  test('duty off: staff are bounced to their own area, exactly as before', async () => {
    dutyConfig(false);
    tokenStore.set(fakeToken('incoming_staff'));
    renderAt('/outgoing');
    expect(await screen.findByText('incoming dashboard')).toBeInTheDocument();
    expect(screen.queryByText('outgoing dashboard')).not.toBeInTheDocument();
  });

  test('a slow config endpoint counts as off', async () => {
    resetRosterDutyCache({ timeout: 50 });
    api.get.mockImplementation(() => new Promise(() => {})); // never answers
    tokenStore.set(fakeToken('incoming_staff'));
    renderAt('/outgoing');
    expect(await screen.findByText('incoming dashboard')).toBeInTheDocument();
  });

  test('nobody else asks: own-area staff and non-staff roles make no config request', async () => {
    dutyConfig(true);
    tokenStore.set(fakeToken('outgoing_staff'));
    renderAt('/outgoing');
    expect(await screen.findByText('outgoing dashboard')).toBeInTheDocument();
    tokenStore.set(fakeToken('supervisor'));
    renderAt('/incoming'); // bounced home at once, as on main
    expect(api.get).not.toHaveBeenCalledWith('/shifts/duty/config');
  });

  test('a failing config endpoint counts as off', async () => {
    api.get.mockRejectedValue(new Error('down'));
    tokenStore.set(fakeToken('outgoing_staff'));
    renderAt('/incoming');
    await waitFor(() => expect(screen.getByText('outgoing dashboard')).toBeInTheDocument());
  });
});

describe('navFor', () => {
  test('flag off (or non-staff roles): exactly the role’s own entries', () => {
    expect(navFor('outgoing_staff', false)).toEqual(NAV.outgoing_staff);
    expect(navFor('supervisor', true)).toEqual(NAV.supervisor);
  });

  test('flag on: a staff member also gets the other staff area’s handover links', () => {
    const items = navFor('incoming_staff', true).map((i) => i.to);
    expect(items).toContain('/incoming');
    expect(items).toContain('/outgoing');
    expect(items).toContain('/outgoing/history');
    // Nothing was lost from their own navigation.
    NAV.incoming_staff.forEach((i) => expect(items).toContain(i.to));
  });
});
