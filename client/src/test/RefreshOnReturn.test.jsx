// R2: refetch on return (tab shown, window focus, back online), polling at
// 5 s that pauses while hidden, and the "Updated just now" indicator.
import { act, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import SyncStatus from '../components/shell/SyncStatus';
import {
  STALE_AFTER_MS, freshness, markSynced, requestRefresh, startRefreshTriggers, useRefresh,
} from '../lib/refresh';
import usePolling from '../lib/usePolling';

let hidden = false;
let stop;
beforeEach(() => {
  vi.useFakeTimers();
  hidden = false;
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  stop = startRefreshTriggers();
});
afterEach(() => {
  stop();
  vi.useRealTimers();
});

const fire = (target, type) => act(() => {
  target.dispatchEvent(new Event(type));
  vi.advanceTimersByTime(400); // past the 300 ms coalescing window
});

describe('return triggers', () => {
  test('focus, back online and the tab being shown each ask screens to refetch', () => {
    const fn = vi.fn();
    renderHook(() => useRefresh(fn));
    fire(window, 'focus');
    fire(window, 'online');
    fire(document, 'visibilitychange');
    expect(fn).toHaveBeenCalledTimes(3);
    expect(fn).toHaveBeenLastCalledWith('return');
  });

  test('focus and visibilitychange together cause one refetch, not two', () => {
    const fn = vi.fn();
    renderHook(() => useRefresh(fn));
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('focus'));
      vi.advanceTimersByTime(400);
    });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('hiding the tab does not refetch', () => {
    const fn = vi.fn();
    renderHook(() => useRefresh(fn));
    hidden = true;
    fire(document, 'visibilitychange');
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('polling', () => {
  test('stays at 5 s, pauses while hidden, and also runs on focus', () => {
    const fn = vi.fn();
    renderHook(() => usePolling(fn));
    expect(fn).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(5000));
    expect(fn).toHaveBeenCalledTimes(2);

    act(() => vi.advanceTimersByTime(2000));
    fire(window, 'focus');
    expect(fn).toHaveBeenCalledTimes(3);

    hidden = true;
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    act(() => vi.advanceTimersByTime(60000));
    expect(fn).toHaveBeenCalledTimes(3);
  });

  test('a focus right after a poll does not poll twice', () => {
    const fn = vi.fn();
    renderHook(() => usePolling(fn));
    fire(window, 'focus'); // 400 ms after the first poll
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('freshness indicator', () => {
  test('labels', () => {
    const t = 1_000_000;
    expect(freshness(t, t + 3000)).toEqual({ label: 'Updated just now', stale: false });
    expect(freshness(t, t + 20000)).toEqual({ label: 'Updated 20 s ago', stale: false });
    expect(freshness(t, t + STALE_AFTER_MS)).toEqual({ label: 'Updated 30 s ago', stale: true });
    expect(freshness(t, t + 5 * 60000)).toEqual({ label: 'Updated 5 min ago', stale: true });
    expect(freshness(t, t + 3000, false)).toEqual({ label: 'Offline · updated just now', stale: true });
    expect(freshness(null, t)).toEqual({ label: 'Updating…', stale: false });
  });

  test('SyncStatus shows "Updated just now", turns stale, and refetches on tap', () => {
    const fn = vi.fn();
    renderHook(() => useRefresh(fn));
    act(() => markSynced(Date.now()));
    render(<SyncStatus />);
    const button = screen.getByRole('button', { name: /Updated just now/ });
    expect(button.className).toMatch(/text-white\/60/);

    act(() => vi.advanceTimersByTime(35000));
    expect(button).toHaveAccessibleName(/Updated 35 s ago/);
    expect(button.className).toMatch(/text-status-amber-line/);

    act(() => {
      button.click();
      vi.advanceTimersByTime(400);
    });
    expect(fn).toHaveBeenCalledWith('manual');
  });
});
