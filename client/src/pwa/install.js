import { useSyncExternalStore } from 'react';

// Install UX (Q3). Chromium browsers fire beforeinstallprompt when the app is
// installable; we keep the event and offer "Install app" in the user menu.
// iOS Safari never fires it, so iPhone and iPad users get a hint instead
// (Share, then Add to Home Screen). Nothing shows once the app is installed.
let deferred = null;
let installed = false;
const subscribers = new Set();
const emit = () => subscribers.forEach((fn) => fn());

// Called once from main.jsx, before React renders: the event can fire early.
export function listenForInstall(target = window) {
  target.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault(); // keep the browser's own mini-infobar out of the way
    deferred = event;
    emit();
  });
  target.addEventListener('appinstalled', () => {
    deferred = null;
    installed = true;
    emit();
  });
}

export function isStandalone() {
  return window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

// iPadOS reports itself as a Mac; a touch screen gives it away.
export function isIOS(nav = window.navigator) {
  return /iphone|ipad|ipod/i.test(nav.userAgent) || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1);
}

// 'prompt' (the browser can install), 'ios' (show the hint) or null.
function mode() {
  if (installed || isStandalone()) return null;
  if (deferred) return 'prompt';
  return isIOS() ? 'ios' : null;
}

export function useInstallMode() {
  return useSyncExternalStore((fn) => { subscribers.add(fn); return () => subscribers.delete(fn); }, mode);
}

// Shows the browser's install dialog. The event can be used only once.
export async function promptInstall() {
  const event = deferred;
  if (!event) return null;
  deferred = null;
  emit();
  await event.prompt();
  const { outcome } = await event.userChoice;
  return outcome;
}
