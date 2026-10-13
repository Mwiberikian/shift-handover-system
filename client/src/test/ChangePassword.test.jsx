// NFR-05: a session with a temporary password (pwd_change claim) sees only the
// change-password screen; a successful change swaps in the new session and
// goes to the role's home.
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, test, vi } from 'vitest';
import api, { tokenStore } from '../api';
import App from '../App';
import { AuthProvider } from '../auth/AuthContext';
import { ThemeProvider } from '../theme/ThemeContext';
import { fakeToken } from './helpers';

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, default: { get: vi.fn(() => new Promise(() => {})), post: vi.fn(), patch: vi.fn() } };
});

const renderApp = (route) => render(
  <ThemeProvider>
    <MemoryRouter initialEntries={[route]}>
      <AuthProvider><App /></AuthProvider>
    </MemoryRouter>
  </ThemeProvider>,
);

describe('temporary password gate (NFR-05)', () => {
  test.each(['/outgoing', '/messages', '/', '/admin/users'])('%s goes to the change-password screen', async (route) => {
    tokenStore.set(fakeToken('outgoing_staff', { pwd_change: true }));
    renderApp(route);
    expect(await screen.findByRole('heading', { name: /choose a new password/i })).toBeInTheDocument();
    expect(screen.getByText(/signed in with a temporary password/i)).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument();
  });

  test('a successful change stores the new session and opens the dashboard', async () => {
    tokenStore.set(fakeToken('outgoing_staff', { pwd_change: true }));
    const fresh = fakeToken('outgoing_staff');
    api.post.mockResolvedValue({ data: { token: fresh, user: { full_name: 'Amina Wekesa', role: 'outgoing_staff', must_change_password: false } } });
    const user = userEvent.setup();
    renderApp('/outgoing');

    await user.type(await screen.findByLabelText(/temporary password/i), 'TempPass2345ab');
    await user.type(screen.getByLabelText(/^new password/i), 'Runway-Lights-42');
    const submit = screen.getByRole('button', { name: 'Change password' });
    expect(submit).toBeDisabled();
    await user.type(screen.getByLabelText(/confirm new password/i), 'Runway-Lights-42');
    await user.click(submit);

    expect(api.post).toHaveBeenCalledWith('/auth/change-password', { current_password: 'TempPass2345ab', new_password: 'Runway-Lights-42' });
    expect(tokenStore.get()).toBe(fresh);
    expect((await screen.findAllByRole('navigation', { name: 'Main' })).length).toBeGreaterThan(0);
  });

  test('mismatched confirmation keeps the button disabled and says why', async () => {
    tokenStore.set(fakeToken('outgoing_staff', { pwd_change: true }));
    const user = userEvent.setup();
    renderApp('/change-password');
    await user.type(await screen.findByLabelText(/temporary password/i), 'TempPass2345ab');
    await user.type(screen.getByLabelText(/^new password/i), 'Runway-Lights-42');
    await user.type(screen.getByLabelText(/confirm new password/i), 'Runway-Lights-43');
    expect(screen.getByText('The passwords do not match')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change password' })).toBeDisabled();
  });

  test('a normal session is not sent to the change-password screen', async () => {
    tokenStore.set(fakeToken('outgoing_staff'));
    renderApp('/outgoing');
    expect((await screen.findAllByRole('navigation', { name: 'Main' })).length).toBeGreaterThan(0);
    expect(screen.queryByRole('heading', { name: /choose a new password/i })).not.toBeInTheDocument();
  });
});
