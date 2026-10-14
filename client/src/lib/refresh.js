import { useEffect, useRef, useSyncExternalStore } from 'react';

// Refetch on return (R2). A phone that was locked, a tab in the background or
// a dropped connection misses the 5 s polls (they pause while hidden), so when
// the user comes back (tab shown, window focused, connection back) every
// screen that subscribed refetches at once: the bell, the unread counts, the
// handover list and the record that is open. A new notification also asks
// screens to refetch, so an incoming handover appears without a reload.
const listeners = new Set();
const COALESCE_MS = 300; // focus + visibilitychange usually fire together
let pending = null;

export function requestRefresh(reason = 'manual') {
  if (pending) return;
  pending = setTimeout(() => {
    pending = null;
    listeners.forEach((fn) => fn(reason));
  }, COALESCE_MS);
}

// Calls `fn` whenever a refresh is requested. `fn` may change between renders.
export function useRefresh(fn, enabled = true) {
  const latest = useRef(fn);
  latest.current = fn;
  useEffect(() => {
    if (!enabled) return undefined;
    const listener = (reason) => latest.current(reason);
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, [enabled]);
}

// Installed once from main.jsx.
export function startRefreshTriggers(win = window, doc = document) {
  const onReturn = () => { if (!doc.hidden) requestRefresh('return'); };
  win.addEventListener('focus', onReturn);
  win.addEventListener('online', onReturn);
  doc.addEventListener('visibilitychange', onReturn);
  return () => {
    win.removeEventListener('focus', onReturn);
    win.removeEventListener('online', onReturn);
    doc.removeEventListener('visibilitychange', onReturn);
  };
}

// When the app last heard from the server (any successful poll or refetch),
// for the "Updated just now" indicator.
let lastSynced = null;
const syncSubscribers = new Set();

export function markSynced(at = Date.now()) {
  lastSynced = at;
  syncSubscribers.forEach((fn) => fn());
}

export function useLastSynced() {
  return useSyncExternalStore(
    (fn) => { syncSubscribers.add(fn); return () => syncSubscribers.delete(fn); },
    () => lastSynced,
  );
}

// Older than this, the data on screen counts as stale.
export const STALE_AFTER_MS = 30 * 1000;

export function freshness(syncedAt, now, online = true) {
  if (!syncedAt) return { label: online ? 'Updating…' : 'Offline', stale: !online };
  const age = Math.max(0, now - syncedAt);
  const ago = age < 15 * 1000 ? 'just now'
    : age < 60 * 1000 ? `${Math.round(age / 1000)} s ago`
      : `${Math.round(age / 60000)} min ago`;
  const stale = !online || age >= STALE_AFTER_MS;
  return { label: `${online ? 'Updated' : 'Offline · updated'} ${ago}`, stale };
}
