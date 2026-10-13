import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import usePolling, { POLL_MS } from '../lib/usePolling';

let hidden = false;
beforeEach(() => {
  vi.useFakeTimers();
  hidden = false;
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
});
afterEach(() => vi.useRealTimers());

const setHidden = (value) => act(() => {
  hidden = value;
  document.dispatchEvent(new Event('visibilitychange'));
});

test('polls every 5 seconds', () => {
  expect(POLL_MS).toBe(5000);
  const fn = vi.fn();
  renderHook(() => usePolling(fn));
  expect(fn).toHaveBeenCalledTimes(1);
  act(() => vi.advanceTimersByTime(5000));
  expect(fn).toHaveBeenCalledTimes(2);
  act(() => vi.advanceTimersByTime(15000));
  expect(fn).toHaveBeenCalledTimes(5);
});

test('pauses while the tab is hidden and polls at once when shown', () => {
  const fn = vi.fn();
  renderHook(() => usePolling(fn));
  setHidden(true);
  act(() => vi.advanceTimersByTime(60000));
  expect(fn).toHaveBeenCalledTimes(1);

  setHidden(false);
  expect(fn).toHaveBeenCalledTimes(2);
  act(() => vi.advanceTimersByTime(5000));
  expect(fn).toHaveBeenCalledTimes(3);
});

test('does not start while disabled and stops on unmount', () => {
  const fn = vi.fn();
  const { rerender, unmount } = renderHook(({ on }) => usePolling(fn, POLL_MS, on), { initialProps: { on: false } });
  act(() => vi.advanceTimersByTime(20000));
  expect(fn).not.toHaveBeenCalled();

  rerender({ on: true });
  expect(fn).toHaveBeenCalledTimes(1);
  unmount();
  act(() => vi.advanceTimersByTime(20000));
  expect(fn).toHaveBeenCalledTimes(1);
});
