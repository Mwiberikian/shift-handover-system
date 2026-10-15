// Part M6: timer tick maths (server-clock offset, elapsed time, formatting)
// and the live board's polling: every 5 s while visible, paused while hidden.
import { act, screen } from '@testing-library/react';
import {
  afterEach, beforeEach, describe, expect, test, vi,
} from 'vitest';
import api, { tokenStore } from '../api';
import LivePage, { sessionMs } from '../pages/LivePage';
import { clockOffset, elapsedSince, fmtClock } from '../lib/live';
import { fakeToken, renderWithProviders } from './helpers';

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } };
});

describe('tick maths', () => {
  const SERVER_NOW = Date.parse('2026-10-15T10:00:00.000Z');

  test.each([
    ['in step', 0],
    ['5 minutes fast', 5 * 60000],
    ['3 minutes 20 s slow', -200000],
  ])('a browser clock %s still gives the server\'s elapsed time', (_, skew) => {
    const browserNow = SERVER_NOW + skew;
    const offset = clockOffset(new Date(SERVER_NOW).toISOString(), browserNow);
    expect(offset).toBe(0 - skew || 0);
    const startedAt = new Date(SERVER_NOW - 754000).toISOString(); // 12 min 34 s before server_now
    expect(elapsedSince(startedAt, offset, browserNow)).toBe(754000);
    // ... and keeps ticking with the browser clock.
    expect(elapsedSince(startedAt, offset, browserNow + 26000)).toBe(780000);
  });

  test('never negative; nothing started is zero', () => {
    expect(elapsedSince(new Date(SERVER_NOW + 5000).toISOString(), 0, SERVER_NOW)).toBe(0);
    expect(elapsedSince(null, 0, SERVER_NOW)).toBe(0);
  });

  test('fmtClock: m:ss under an hour, h:mm:ss after', () => {
    expect(fmtClock(0)).toBe('0:00');
    expect(fmtClock(7999)).toBe('0:07');
    expect(fmtClock(754000)).toBe('12:34');
    expect(fmtClock(3600000)).toBe('1:00:00');
    expect(fmtClock(3723000)).toBe('1:02:03');
    expect(fmtClock(-5)).toBe('0:00');
  });

  test('an ended session shows its final length; a running one ticks', () => {
    const offset = 0;
    const startedAt = new Date(SERVER_NOW - 3600000).toISOString();
    expect(sessionMs({ started_at: startedAt, ended_at: new Date(SERVER_NOW).toISOString(), elapsed_ms: 1800000 }, offset, SERVER_NOW + 999999)).toBe(1800000);
    expect(sessionMs({ started_at: startedAt, ended_at: null }, offset, SERVER_NOW)).toBe(3600000);
    expect(sessionMs(null, offset, SERVER_NOW)).toBeNull();
  });
});

describe('live board polling', () => {
  let hidden = false;
  beforeEach(() => {
    vi.resetAllMocks();
    hidden = false;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'] });
    tokenStore.set(fakeToken('supervisor'));
    api.get.mockImplementation(() => Promise.resolve({
      data: {
        server_now: new Date().toISOString(), department: { department_id: 'd1', name: 'Ground Operations' }, shift: null, workers: [], totals: { workers: 0 },
      },
    }));
  });
  afterEach(() => vi.useRealTimers());

  const polls = () => api.get.mock.calls.filter(([url]) => url === '/supervisor/live').length;

  test('every 5 seconds while visible; none while hidden; at once when shown again', async () => {
    renderWithProviders(<LivePage />);
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(polls()).toBe(1);
    expect(screen.getByText('No shift on now')).toBeInTheDocument();

    await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
    expect(polls()).toBe(4);

    hidden = true;
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    expect(polls()).toBe(4);

    hidden = false;
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(polls()).toBe(5);
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(polls()).toBe(6);
  });

  test('the on-screen clocks stop ticking while hidden', async () => {
    const started = new Date(Date.now() - 60000).toISOString();
    api.get.mockImplementation(() => Promise.resolve({
      data: {
        server_now: new Date().toISOString(),
        department: { department_id: 'd1', name: 'Ground Operations' },
        shift: { shift_id: 's1', shift_type: 'day', start_time: started, end_time: new Date(Date.now() + 3600000).toISOString() },
        workers: [{
          user_id: 'u1', full_name: 'Achieng Otieno', staff_number: 'KQ1001', role: 'outgoing_staff', state: 'working',
          session: { started_at: started, ended_at: null, elapsed_ms: 60000 }, current_task: null,
          tasks: { open: 0, in_progress: 0, resolved: 0 }, incident_count: 0, last_activity_at: null,
        }],
        totals: {
          workers: 1, working: 1, idle: 0, not_started: 0, ended: 0, handover_submitted: 0, open: 0, in_progress: 0, resolved: 0,
        },
      },
    }));
    renderWithProviders(<LivePage />);
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(screen.getByText('1:00')).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(screen.getByText('1:03')).toBeInTheDocument();

    hidden = true;
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
    expect(screen.getByText('1:03')).toBeInTheDocument(); // no re-render while hidden

    hidden = false;
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(screen.getByText('1:33')).toBeInTheDocument(); // caught up from started_at
  });
});
