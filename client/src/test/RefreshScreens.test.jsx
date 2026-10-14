// R2: an open screen refetches its list and record when a refresh is
// requested (a new notification, or the user returning), without a reload.
import { act, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import api, { tokenStore } from '../api';
import { requestRefresh } from '../lib/refresh';
import IncomingPage from '../pages/IncomingPage';
import { fakeToken, renderWithProviders } from './helpers';

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } };
});

beforeEach(() => tokenStore.set(fakeToken('incoming_staff')));
afterEach(() => tokenStore.clear());

describe('screens refetch', () => {
  test('the incoming inbox picks up a new handover on refresh, without a reload', async () => {
    const RECORD = {
      record_id: 'r1', status: 'submitted', department_code: 'ground_ops', outgoing_name: 'Amina Otieno', shift_type: 'day', shift_start: '2026-10-14T03:00:00Z', submitted_at: '2026-10-14T14:00:00Z', tasks: [], incidents: [],
    };
    let list = [];
    api.get.mockImplementation((url) => {
      if (url === '/handovers') return Promise.resolve({ data: list });
      if (url === '/handovers/r1') return Promise.resolve({ data: { ...RECORD, summary_notes: 'Stands 4 and 5 clear.' } });
      if (url === '/auth/me') return Promise.resolve({ data: { full_name: 'Brian Kamau' } });
      return Promise.resolve({ data: null });
    });
    renderWithProviders(<IncomingPage view="pending" />);
    expect(await screen.findByText("You're all caught up")).toBeInTheDocument();

    list = [RECORD];
    act(() => requestRefresh('notification'));
    expect(await screen.findByText('Stands 4 and 5 clear.', {}, { timeout: 2000 })).toBeInTheDocument();
  });
});
