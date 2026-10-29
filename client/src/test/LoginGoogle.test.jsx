import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { expect, test, vi } from 'vitest';
import api from '../api';
import Login from '../pages/Login';
import { fakeToken, renderWithProviders } from './helpers';

// Separate file from Login.test.jsx because GoogleButton caches the client id
// for the life of the module; here Google sign-in is configured.
vi.mock('@react-oauth/google', () => ({
  GoogleOAuthProvider: ({ children }) => children,
  GoogleLogin: ({ onSuccess }) => <button type="button" onClick={() => onSuccess({ credential: 'google-id-token' })}>Continue with Google</button>,
}));

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, default: { get: vi.fn(), post: vi.fn() } };
});

test('Google sign-in, when configured, lands on the role home', async () => {
  api.get.mockResolvedValue({ data: { client_id: 'test-client-id' } });
  api.post.mockResolvedValue({ data: { token: fakeToken('supervisor'), user: { role: 'supervisor' } } });
  const user = userEvent.setup();
  renderWithProviders(
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/supervisor" element={<p>supervisor home</p>} />
    </Routes>,
    { route: '/login' },
  );

  expect(await screen.findByText(/or continue with/i)).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /continue with google/i }));

  expect(await screen.findByText('supervisor home')).toBeInTheDocument();
  expect(api.post).toHaveBeenCalledWith('/auth/google', { credential: 'google-id-token' });
});
