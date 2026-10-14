import api from '../api';

// Web Push on this device (Part R3). The browser's permission prompt appears
// only when the user turns the switch on, never on page load. Turning it off
// unsubscribes this browser and tells the server to forget it.

export function pushSupported() {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

// The VAPID public key arrives base64url-encoded; PushManager wants bytes.
export function keyToBytes(base64url) {
  const padded = `${base64url}${'='.repeat((4 - (base64url.length % 4)) % 4)}`.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

export async function pushConfig() {
  const { data } = await api.get('/push/config');
  return data;
}

async function registration() {
  return navigator.serviceWorker.ready;
}

export async function currentSubscription() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}

// Returns 'on', or 'denied' when the user (or the browser) refused.
export async function enablePush(publicKey) {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return 'denied';
  const reg = await registration();
  const sub = await reg.pushManager.getSubscription()
    ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(publicKey) });
  const { endpoint, keys } = sub.toJSON();
  await api.post('/push/subscribe', { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } });
  return 'on';
}

// token: pass the session token when signing out, because the stored one is
// cleared before this finishes.
export async function disablePush({ token } = {}) {
  const sub = await currentSubscription();
  if (!sub) return;
  const { endpoint } = sub;
  await sub.unsubscribe().catch(() => {});
  const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
  await api.delete('/push/subscribe', { data: { endpoint }, headers });
}
