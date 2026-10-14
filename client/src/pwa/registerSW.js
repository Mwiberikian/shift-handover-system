import { useSyncExternalStore } from 'react';

// Service worker registration (Q2) and the "update available" state behind
// UpdatePrompt. The worker precaches the app shell only (pwa.config.js); a new
// build waits until the user chooses Reload, so an open form is never swapped
// out from under them.
let needRefresh = false;
let updateSW = null;
const subscribers = new Set();
const emit = () => subscribers.forEach((fn) => fn());

// Hourly check for a new build while the app stays open (a shift is 12 h).
const UPDATE_CHECK_MS = 60 * 60 * 1000;

export function startServiceWorker() {
  if (import.meta.env.DEV || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  import('virtual:pwa-register').then(({ registerSW }) => {
    updateSW = registerSW({
      onNeedRefresh() { setNeedRefresh(true); },
      onRegisteredSW(_url, registration) {
        if (registration) setInterval(() => registration.update().catch(() => {}), UPDATE_CHECK_MS);
      },
    });
  }).catch(() => {
    // No service worker: the app still works, it just isn't cached.
  });
}

export function setNeedRefresh(value) {
  if (needRefresh !== value) {
    needRefresh = value;
    emit();
  }
}

export function useUpdateAvailable() {
  return useSyncExternalStore(
    (fn) => { subscribers.add(fn); return () => subscribers.delete(fn); },
    () => needRefresh,
  );
}

// Activates the waiting worker and reloads the page on the new version.
export function applyUpdate() {
  if (updateSW) updateSW(true);
  else window.location.reload();
}
