// R3: with push off on the server, the menu shows no push switch.
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import api, { tokenStore } from '../api';
import UserMenu from '../components/shell/UserMenu';
import { fakeToken, renderWithProviders } from './helpers';

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } };
});

afterEach(() => {
  delete window.PushManager;
  delete window.Notification;
  delete navigator.serviceWorker;
});

test('hidden when the server has push off', async () => {
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { getRegistration: vi.fn().mockResolvedValue(null) } });
  window.PushManager = function PushManager() {};
  window.Notification = { permission: 'default', requestPermission: vi.fn() };
  api.get.mockImplementation((url) => Promise.resolve({
    data: url === '/push/config' ? { enabled: false, public_key: null } : { full_name: 'Brian Kamau', role: 'incoming_staff', email_notifications: true },
  }));
  tokenStore.set(fakeToken('incoming_staff'));
  const user = userEvent.setup();
  renderWithProviders(<UserMenu />);
  await user.click(await screen.findByRole('button', { name: 'Account menu for Brian Kamau' }));
  await screen.findByRole('switch', { name: /email alerts/i });
  await new Promise((r) => { setTimeout(r, 50); });
  expect(api.get).toHaveBeenCalledWith('/push/config');
  expect(screen.queryByRole('switch', { name: /push notifications/i })).toBeNull();
  expect(window.Notification.requestPermission).not.toHaveBeenCalled();
});
