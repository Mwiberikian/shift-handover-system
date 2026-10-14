// R1: the signed-in user's theme comes from the server, is cached locally for
// the next first paint, and a change on this device is saved to the server.
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import api, { tokenStore } from '../api';
import ThemeToggle from '../components/shell/ThemeToggle';
import { PreferenceSync } from '../lib/preferences';
import { THEME_KEY } from '../theme/ThemeContext';
import { fakeToken, renderWithProviders } from './helpers';

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } };
});

const PROFILE = { user_id: 'user-outgoing_staff', full_name: 'Amina Otieno', email_notifications: true };
const isDark = () => document.documentElement.classList.contains('dark');

afterEach(() => {
  localStorage.clear();
  tokenStore.clear();
  document.documentElement.classList.remove('dark');
});

describe('applying the saved theme', () => {
  test('a dark preference from the server is applied and cached', async () => {
    tokenStore.set(fakeToken('outgoing_staff'));
    api.get.mockResolvedValue({ data: { ...PROFILE, theme_preference: 'dark' } });
    renderWithProviders(<PreferenceSync />);
    await waitFor(() => expect(isDark()).toBe(true));
    expect(localStorage.getItem(THEME_KEY)).toBe('dark');
  });

  test('the server wins over this device\'s cached choice', async () => {
    localStorage.setItem(THEME_KEY, 'dark');
    tokenStore.set(fakeToken('outgoing_staff'));
    api.get.mockResolvedValue({ data: { ...PROFILE, theme_preference: 'light' } });
    renderWithProviders(<PreferenceSync />);
    await waitFor(() => expect(localStorage.getItem(THEME_KEY)).toBe('light'));
    expect(isDark()).toBe(false);
  });

  test('"system" clears the cache, so first paint follows the device', async () => {
    localStorage.setItem(THEME_KEY, 'dark');
    tokenStore.set(fakeToken('outgoing_staff'));
    api.get.mockResolvedValue({ data: { ...PROFILE, theme_preference: 'system' } });
    renderWithProviders(<PreferenceSync />);
    await waitFor(() => expect(localStorage.getItem(THEME_KEY)).toBeNull());
    expect(isDark()).toBe(false); // the test OS prefers light
  });
});

describe('changing the theme', () => {
  test('signed in, the choice is saved to the server', async () => {
    tokenStore.set(fakeToken('outgoing_staff'));
    api.get.mockResolvedValue({ data: { ...PROFILE, theme_preference: 'light' } });
    api.patch.mockResolvedValue({ data: { theme_preference: 'dark', email_notifications: true } });
    const user = userEvent.setup();
    renderWithProviders(<><PreferenceSync /><ThemeToggle /></>);
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/auth/me'));

    await user.click(screen.getByRole('button', { name: 'Dark theme' }));
    expect(isDark()).toBe(true);
    expect(api.patch).toHaveBeenCalledWith('/auth/me/preferences', { theme_preference: 'dark' });
    expect(localStorage.getItem(THEME_KEY)).toBe('dark');
  });

  test('signed out, it stays on this device', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ThemeToggle />);
    await user.click(screen.getByRole('button', { name: 'Dark theme' }));
    expect(isDark()).toBe(true);
    expect(api.patch).not.toHaveBeenCalled();
  });
});
