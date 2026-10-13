// IR-05: the user menu holds the user's own email-alert switch.
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import api, { tokenStore } from '../api';
import UserMenu from '../components/shell/UserMenu';
import { fakeToken, renderWithProviders } from './helpers';

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } };
});

const PROFILE = {
  full_name: 'Brian Kamau', role: 'incoming_staff', department_name: 'Ground Operations', email: 'brian.kamau@shms.example', email_notifications: true,
};

describe('email alerts switch', () => {
  test('shows the current setting and turns it off and on through the API', async () => {
    tokenStore.set(fakeToken('incoming_staff'));
    api.get.mockResolvedValue({ data: PROFILE });
    api.patch.mockResolvedValueOnce({ data: { email_notifications: false } }).mockResolvedValueOnce({ data: { email_notifications: true } });
    const user = userEvent.setup();
    renderWithProviders(<UserMenu />);

    await user.click(await screen.findByRole('button', { name: 'Account menu for Brian Kamau' }));
    const sw = await screen.findByRole('switch', { name: /email alerts/i });
    expect(sw).toHaveAttribute('aria-checked', 'true');

    await user.click(sw);
    expect(api.patch).toHaveBeenLastCalledWith('/auth/me/preferences', { email_notifications: false });
    expect(await screen.findByRole('switch', { name: /email alerts/i })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText('Off: in-app only')).toBeInTheDocument();

    await user.click(screen.getByRole('switch', { name: /email alerts/i }));
    expect(api.patch).toHaveBeenLastCalledWith('/auth/me/preferences', { email_notifications: true });
    expect(await screen.findByRole('switch', { name: /email alerts/i })).toHaveAttribute('aria-checked', 'true');
  });

  test('the menu offers a password change', async () => {
    tokenStore.set(fakeToken('incoming_staff'));
    api.get.mockResolvedValue({ data: PROFILE });
    const user = userEvent.setup();
    renderWithProviders(<UserMenu />);
    await user.click(await screen.findByRole('button', { name: 'Account menu for Brian Kamau' }));
    expect(screen.getByRole('link', { name: 'Change password' })).toHaveAttribute('href', '/change-password');
  });
});
