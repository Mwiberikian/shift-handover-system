// Q3: "Install app" in the user menu when the browser offers installation,
// and the Share > Add to Home Screen hint on iPhone and iPad.
import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import api, { tokenStore } from '../api';
import UserMenu from '../components/shell/UserMenu';
import { isIOS, listenForInstall } from '../pwa/install';
import { fakeToken, renderWithProviders } from './helpers';

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } };
});

const PROFILE = { full_name: 'Brian Kamau', role: 'incoming_staff', department_name: 'Ground Operations', email_notifications: true };
const DESKTOP_UA = navigator.userAgent;
const setUA = (ua) => Object.defineProperty(navigator, 'userAgent', { configurable: true, get: () => ua });

beforeAll(() => listenForInstall(window));
afterEach(() => setUA(DESKTOP_UA));

async function openMenu() {
  tokenStore.set(fakeToken('incoming_staff'));
  api.get.mockResolvedValue({ data: PROFILE });
  const user = userEvent.setup();
  renderWithProviders(<UserMenu />);
  await user.click(await screen.findByRole('button', { name: 'Account menu for Brian Kamau' }));
  return user;
}

describe('Install app', () => {
  test('is not offered until the browser fires beforeinstallprompt', async () => {
    await openMenu();
    expect(screen.queryByRole('button', { name: 'Install app' })).toBeNull();
  });

  test('opens the browser install dialog, then disappears once installed', async () => {
    const user = await openMenu();
    const event = new Event('beforeinstallprompt', { cancelable: true });
    event.prompt = vi.fn().mockResolvedValue(undefined);
    event.userChoice = Promise.resolve({ outcome: 'accepted' });
    act(() => { window.dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Install app' }));
    expect(event.prompt).toHaveBeenCalledTimes(1);
    act(() => { window.dispatchEvent(new Event('appinstalled')); });
    expect(screen.queryByRole('button', { name: 'Install app' })).toBeNull();
  });
});

describe('iOS', () => {
  test('detects iPhone, and iPad that reports itself as a Mac', () => {
    expect(isIOS({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', platform: 'iPhone', maxTouchPoints: 5 })).toBe(true);
    expect(isIOS({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'MacIntel', maxTouchPoints: 5 })).toBe(true);
    expect(isIOS({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'MacIntel', maxTouchPoints: 0 })).toBe(false);
    expect(isIOS({ userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9)', platform: 'Linux armv8l', maxTouchPoints: 5 })).toBe(false);
  });
});
