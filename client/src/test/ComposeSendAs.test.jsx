// "Send as" appears for supervisors and admins only and is sent with the message.
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import api, { tokenStore } from '../api';
import ComposeDialog from '../components/messages/ComposeDialog';
import { fakeToken, renderWithProviders } from './helpers';

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } };
});

const PERSON = { user_id: 'u-2', full_name: 'Brian Kamau', role: 'incoming_staff', department_name: 'Ground Operations' };

function setup(role) {
  tokenStore.set(fakeToken(role));
  api.get.mockImplementation((url) => Promise.resolve({ data: url === '/directory' ? [PERSON] : [] }));
  api.post.mockResolvedValue({ data: {} });
  return renderWithProviders(<ComposeDialog open onClose={() => {}} initial={{ person: PERSON }} />);
}

describe('Send as', () => {
  test('a supervisor chooses Email and it is sent with the message; the email never carries the text', async () => {
    const user = userEvent.setup();
    setup('supervisor');
    expect(screen.getByRole('radio', { name: 'System notification' })).toBeChecked();
    await user.click(screen.getByRole('radio', { name: 'Email' }));
    expect(screen.getByText(/the message text is not emailed/i)).toBeInTheDocument();
    await user.type(screen.getByLabelText(/^message/i), 'Stand 5 GPU is back.');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(api.post).toHaveBeenCalledWith('/messages', expect.objectContaining({
      recipient_type: 'user', recipient_user_id: 'u-2', body: 'Stand 5 GPU is back.', send_as: 'email',
    }));
  });

  test.each(['outgoing_staff', 'incoming_staff'])('%s does not see it and sends no send_as', async (role) => {
    const user = userEvent.setup();
    setup(role);
    expect(screen.queryByRole('radio', { name: 'Email' })).not.toBeInTheDocument();
    await user.type(screen.getByLabelText(/^message/i), 'Hello');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(api.post.mock.calls[0][1]).not.toHaveProperty('send_as');
  });
});
