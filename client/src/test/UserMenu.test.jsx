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

describe('calendar subscription', () => {
  test('creates a private feed link shown once, then can revoke it', async () => {
    tokenStore.set(fakeToken('outgoing_staff'));
    const FEED = 'http://localhost:4000/api/shifts/calendar/abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ.ics';
    api.get.mockImplementation((url) => Promise.resolve({ data: url === '/auth/me/calendar-feed' ? { active: false, created_at: null } : PROFILE }));
    api.post.mockResolvedValue({ data: { active: true, created_at: '2026-10-13T20:00:00Z', url: FEED } });
    api.delete = vi.fn().mockResolvedValue({ data: { active: false, created_at: null } });
    const user = userEvent.setup();
    renderWithProviders(<UserMenu />);

    await user.click(await screen.findByRole('button', { name: 'Account menu for Brian Kamau' }));
    await user.click(screen.getByRole('button', { name: 'Calendar subscription' }));
    expect(await screen.findByText(/leave Shift Handover/)).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Create my feed link' }));
    expect(api.post).toHaveBeenCalledWith('/auth/me/calendar-feed');
    expect(await screen.findByText(FEED)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'webcal' })).toHaveAttribute('href', FEED.replace('http:', 'webcal:'));
    expect(screen.getByText(/Active since 2026-10-13 23:00 EAT/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Revoke' }));
    expect(api.delete).toHaveBeenCalledWith('/auth/me/calendar-feed');
    expect(await screen.findByRole('button', { name: 'Create my feed link' })).toBeInTheDocument();
    expect(screen.queryByText(FEED)).not.toBeInTheDocument();
  });
});
