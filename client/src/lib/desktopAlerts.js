// Optional browser (desktop) notifications for reminders. Permission is only
// ever requested from an explicit click (enableDesktopAlerts), never on load.
const KEY = 'shms-desktop-alerts';

export const desktopSupported = () => typeof window !== 'undefined' && 'Notification' in window;

function stored() {
  try { return localStorage.getItem(KEY) === 'on'; } catch { return false; }
}

// 'unsupported' | 'blocked' | 'on' | 'off'
export function desktopAlertState() {
  if (!desktopSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  return Notification.permission === 'granted' && stored() ? 'on' : 'off';
}

export async function enableDesktopAlerts() {
  if (!desktopSupported()) return 'unsupported';
  const permission = await Notification.requestPermission();
  if (permission === 'granted') {
    try { localStorage.setItem(KEY, 'on'); } catch { /* ignore */ }
  }
  return desktopAlertState();
}

export function disableDesktopAlerts() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  return desktopAlertState();
}

export function showDesktopAlert(title, body, tag) {
  if (desktopAlertState() !== 'on') return;
  try {
    // eslint-disable-next-line no-new
    new Notification(title, { body, tag });
  } catch {
    // Some browsers only allow notifications from a service worker; skip.
  }
}
