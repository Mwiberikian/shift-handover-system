import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import api from '../api';
import { ROLE_HOME } from '../auth/AuthContext';
import Login from '../pages/Login';
import { fakeToken, renderWithProviders } from './helpers';

// Google's own button is an iframe; this stand-in hands back a fixed ID token.
vi.mock('@react-oauth/google', () => ({
  GoogleOAuthProvider: ({ children }) => children,
  GoogleLogin: ({ onSuccess }) => <button type="button" onClick={() => onSuccess({ credential: 'google-id-token' })}>Continue with Google</button>,
}));

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
  await user.click(screen.getByRole('button', { name: /^log in/i }));
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
    expect(screen.getByRole('heading', { name: /welcome back/i })).toBeInTheDocument();
    expect(sessionStorage.getItem('shms_token')).toBeNull();
  });
});

describe('login form', () => {
  test('the eye button shows and hides the password', async () => {
    const user = userEvent.setup();
    renderLogin();
    const password = screen.getByLabelText(/^password/i);
    await user.type(password, 'Password123!');
    expect(password).toHaveAttribute('type', 'password');

    await user.click(screen.getByRole('button', { name: 'Show password' }));
    expect(password).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: 'Hide password' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(password).toHaveAttribute('type', 'password');
  });

  test('the Log in button is disabled while the request is pending', async () => {
    let settle;
    api.post.mockReturnValue(new Promise((resolve) => { settle = resolve; }));
    renderLogin();
    await signIn();

    const button = screen.getByRole('button', { name: /logging in/i });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');

    settle({ data: { token: fakeToken('outgoing_staff'), user: { role: 'outgoing_staff' } } });
    expect(await screen.findByText('outgoing_staff home')).toBeInTheDocument();
  });

  test('a failed sign-in is announced with role alert', async () => {
    api.post.mockRejectedValue({ response: { status: 401, data: { error: 'Invalid credentials' } } });
    renderLogin();
    await signIn('KQ1001', 'wrong');

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText(/password is incorrect/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^password/i)).toHaveValue('');
    expect(screen.getByRole('button', { name: /^log in/i })).toBeEnabled();
  });
});

// The configured case is in LoginGoogle.test.jsx: the client id is cached per module.
describe('Google sign-in', () => {
  test('is hidden when the server has no Google client id', async () => {
    renderLogin();
    await screen.findByRole('heading', { name: /welcome back/i });
    await Promise.resolve();
    expect(screen.queryByRole('button', { name: /continue with google/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/or continue with/i)).not.toBeInTheDocument();
  });

});
