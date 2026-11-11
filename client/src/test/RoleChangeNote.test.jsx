// Phase 1, interim duty switch: the role-change note shown on the next page
// load after a supervisor switched the user's duty.
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import api from '../api';
import RoleChangeNote from '../components/RoleChangeNote';
import { renderWithProviders } from './helpers';

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, default: { get: vi.fn(), post: vi.fn() } };
});

beforeEach(() => vi.clearAllMocks());

describe('role change note', () => {
  const NOTE = {
    notification_id: 'n1', type: 'role_changed', read_at: null, sent_at: new Date().toISOString(),
    title: 'Your duty is now incoming staff', body: 'Test supA moved you to incoming staff duty. You were signed out; sign in again to continue.',
  };

  test('shows the unread note once and dismiss marks it read', async () => {
    api.get.mockResolvedValue({ data: [NOTE] });
    api.post.mockResolvedValue({ data: {} });
    const user = userEvent.setup();
    renderWithProviders(<RoleChangeNote />);

    expect(await screen.findByText('Your duty is now incoming staff')).toBeInTheDocument();
    expect(screen.getByText(/moved you to incoming staff duty/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(api.post).toHaveBeenCalledWith('/notifications/n1/read');
    expect(screen.queryByText('Your duty is now incoming staff')).not.toBeInTheDocument();
  });

  test('renders nothing when the note was already read or absent', async () => {
    api.get.mockResolvedValue({ data: [{ ...NOTE, read_at: new Date().toISOString() }] });
    const { container } = renderWithProviders(<RoleChangeNote />);
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
