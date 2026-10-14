// Q3: on an iPhone (no beforeinstallprompt) the menu explains how to install.
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import api, { tokenStore } from '../api';
import UserMenu from '../components/shell/UserMenu';
import { fakeToken, renderWithProviders } from './helpers';

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } };
});

test('shows the Share, then Add to Home Screen hint on click', async () => {
  Object.defineProperty(navigator, 'userAgent', { configurable: true, get: () => 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1' });
  tokenStore.set(fakeToken('outgoing_staff'));
  api.get.mockResolvedValue({ data: { full_name: 'Amina Otieno', role: 'outgoing_staff', email_notifications: true } });
  const user = userEvent.setup();
  renderWithProviders(<UserMenu />);
  await user.click(await screen.findByRole('button', { name: 'Account menu for Amina Otieno' }));

  const item = screen.getByRole('button', { name: 'Install app' });
  expect(item).toHaveAttribute('aria-expanded', 'false');
  await user.click(item);
  expect(item).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByText(/tap/)).toHaveTextContent('In Safari, tap Share, then Add to Home Screen.');
});
