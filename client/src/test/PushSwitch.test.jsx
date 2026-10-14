// R3: "Push notifications on this device" in the user menu. Permission is
// asked only on click; the service worker shows a title and opens the link.
// (The menu caches the server's push config, so these tests all use push on;
// PushSwitchOff.test.jsx covers push off.)
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import api, { tokenStore } from '../api';
import UserMenu from '../components/shell/UserMenu';
import { keyToBytes } from '../pwa/push';
import { fakeToken, renderWithProviders } from './helpers';

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual, default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  };
});

const KEY = 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U';
const PROFILE = { full_name: 'Brian Kamau', role: 'incoming_staff', email_notifications: true };
let subscription;
let pushManager;

function installPush({ permission = 'default', subscribed = false, enabled = true } = {}) {
  subscription = {
    endpoint: 'https://push.example.net/send/abc',
    toJSON: () => ({ endpoint: 'https://push.example.net/send/abc', keys: { p256dh: 'BKey_abc', auth: 'authAbc' } }),
    unsubscribe: vi.fn().mockResolvedValue(true),
  };
  pushManager = {
    getSubscription: vi.fn().mockResolvedValue(subscribed ? subscription : null),
    subscribe: vi.fn().mockResolvedValue(subscription),
  };
  const registration = { pushManager };
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true, value: { ready: Promise.resolve(registration), getRegistration: vi.fn().mockResolvedValue(registration) },
  });
  window.PushManager = function PushManager() {};
  window.Notification = { permission, requestPermission: vi.fn().mockResolvedValue('granted') };
  api.get.mockImplementation((url) => Promise.resolve({ data: url === '/push/config' ? { enabled, public_key: enabled ? KEY : null } : PROFILE }));
}

async function openMenu() {
  tokenStore.set(fakeToken('incoming_staff'));
  const user = userEvent.setup();
  renderWithProviders(<UserMenu />);
  await user.click(await screen.findByRole('button', { name: 'Account menu for Brian Kamau' }));
  return user;
}

afterEach(() => {
  delete window.PushManager;
  delete window.Notification;
  delete navigator.serviceWorker;
});

describe('push switch', () => {
  test('turning it on asks permission only then, subscribes with the server key and registers the device', async () => {
    installPush();
    const user = await openMenu();
    const sw = await screen.findByRole('switch', { name: /push notifications on this device/i });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    expect(window.Notification.requestPermission).not.toHaveBeenCalled();

    api.post.mockResolvedValue({ data: { subscribed: true } });
    await user.click(sw);
    expect(window.Notification.requestPermission).toHaveBeenCalledTimes(1);
    expect(pushManager.subscribe).toHaveBeenCalledWith({ userVisibleOnly: true, applicationServerKey: keyToBytes(KEY) });
    expect(api.post).toHaveBeenCalledWith('/push/subscribe', { endpoint: 'https://push.example.net/send/abc', keys: { p256dh: 'BKey_abc', auth: 'authAbc' } });
    await waitFor(() => expect(sw).toHaveAttribute('aria-checked', 'true'));
  });

  test('turning it off unsubscribes this browser and tells the server', async () => {
    installPush({ permission: 'granted', subscribed: true });
    const user = await openMenu();
    const sw = await screen.findByRole('switch', { name: /push notifications on this device/i });
    await waitFor(() => expect(sw).toHaveAttribute('aria-checked', 'true'));
    api.delete.mockResolvedValue({ data: { subscribed: false } });
    await user.click(sw);
    expect(subscription.unsubscribe).toHaveBeenCalled();
    expect(api.delete).toHaveBeenCalledWith('/push/subscribe', { data: { endpoint: 'https://push.example.net/send/abc' }, headers: undefined });
    await waitFor(() => expect(sw).toHaveAttribute('aria-checked', 'false'));
  });

  test('a refused permission subscribes nothing', async () => {
    installPush();
    window.Notification.requestPermission.mockResolvedValue('denied');
    const user = await openMenu();
    await user.click(await screen.findByRole('switch', { name: /push notifications on this device/i }));
    expect(pushManager.subscribe).not.toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalledWith('/push/subscribe', expect.anything());
    expect(await screen.findByText('Blocked in browser settings')).toBeInTheDocument();
  });
});

test('keyToBytes decodes base64url', () => {
  expect([...keyToBytes('AQID_-8')]).toEqual([1, 2, 3, 255, 239]);
});

describe('service worker push handler', () => {
  const code = readFileSync(resolve(process.cwd(), 'public/push-sw.js'), 'utf8');
  function runWorker() {
    const handlers = {};
    const self = {
      addEventListener: (type, fn) => { handlers[type] = fn; },
      registration: { showNotification: vi.fn() },
      location: { origin: 'https://shms.example' },
      clients: { matchAll: vi.fn().mockResolvedValue([]), openWindow: vi.fn() },
    };
    // eslint-disable-next-line no-new-func
    new Function('self', code)(self);
    const push = (data) => {
      let done;
      handlers.push({ data: { json: () => data }, waitUntil: (p) => { done = p; } });
      return done;
    };
    return { self, handlers, push };
  }

  test('shows the title only and keeps the link for the tap', async () => {
    const { self, push } = runWorker();
    await push({ title: 'A handover has been submitted', link: '/incoming' });
    const [title, options] = self.registration.showNotification.mock.calls[0];
    expect(title).toBe('A handover has been submitted');
    expect(options.body).toBeUndefined();
    expect(options.data).toEqual({ link: '/incoming' });
  });

  test('never follows a link outside the app', async () => {
    const { self, push } = runWorker();
    await push({ title: 'x', link: 'https://evil.example/' });
    await push({ title: 'x', link: '//evil.example/' });
    expect(self.registration.showNotification.mock.calls.map(([, o]) => o.data.link)).toEqual(['/', '/']);
  });

  test('a tap opens the app at the link', async () => {
    const { self, handlers } = runWorker();
    let done;
    handlers.notificationclick({ notification: { close: vi.fn(), data: { link: '/messages' } }, waitUntil: (p) => { done = p; } });
    await done;
    expect(self.clients.openWindow).toHaveBeenCalledWith('https://shms.example/messages');
  });
});
