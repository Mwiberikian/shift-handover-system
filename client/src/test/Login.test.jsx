import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import api from '../api';
import { ROLE_HOME } from '../auth/AuthContext';
import Login from '../pages/Login';
import { fakeToken, renderWithProviders } from './helpers';

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, default: { get: vi.fn(), post: vi.fn() } };
});

beforeEach(() => {
  // Google sign-in not configured; /auth/me is not needed after login.
  api.get.mockResolvedValue({ data: { client_id: null } });
});

function renderLogin() {
  return renderWithProviders(
    <Routes>
      <Route path="/login" element={<Login />} />
      {Object.entries(ROLE_HOME).map(([role, path]) => (
        <Route key={role} path={path} element={<p>{role} home</p>} />
      ))}
    </Routes>,
    { route: '/login' },
  );
}

async function signIn(identifier = 'KQ1001', password = 'Password123!') {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(/staff number or email/i), identifier);
  await user.type(screen.getByLabelText(/^password/i), password);
  await user.click(screen.getByRole('button', { name: /sign in/i }));
}

describe('login routes by role', () => {
  test.each(Object.entries(ROLE_HOME))('%s lands on %s', async (role) => {
    api.post.mockResolvedValue({ data: { token: fakeToken(role), user: { role } } });
    renderLogin();
    await signIn();

    expect(await screen.findByText(`${role} home`)).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledWith('/auth/login', { identifier: 'KQ1001', password: 'Password123!' });
  });

  test('a 401 shows an error and stays on the sign-in page', async () => {
    api.post.mockRejectedValue({ response: { status: 401, data: { error: 'Invalid credentials' } } });
    renderLogin();
    await signIn('KQ1001', 'wrong');

    expect(await screen.findByText(/password is incorrect/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /sign in/i })).toBeInTheDocument();
    expect(sessionStorage.getItem('shms_token')).toBeNull();
  });
});
