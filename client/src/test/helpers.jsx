// Shared test helpers: unsigned JWTs and the providers pages expect.
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../auth/AuthContext';
import { ThemeProvider } from '../theme/ThemeContext';

const b64url = (obj) => btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// The client only decodes the payload; the server verifies signatures.
export function fakeToken(role, extra = {}) {
  return [
    b64url({ alg: 'HS256', typ: 'JWT' }),
    b64url({
      user_id: `user-${role}`, role, department_id: 'dept-1', exp: Math.floor(Date.now() / 1000) + 1800, ...extra,
    }),
    'signature',
  ].join('.');
}

export function renderWithProviders(ui, { route = '/' } = {}) {
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={[route]}>
        <AuthProvider>{ui}</AuthProvider>
      </MemoryRouter>
    </ThemeProvider>,
  );
}
