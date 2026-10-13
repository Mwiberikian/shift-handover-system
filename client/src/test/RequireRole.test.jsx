import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import api, { tokenStore } from '../api';
import { RequireRole } from '../App';
import { ROLE_HOME } from '../auth/AuthContext';
import { fakeToken, renderWithProviders } from './helpers';

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, default: { get: vi.fn(), post: vi.fn() } };
});

beforeEach(() => {
  api.get.mockResolvedValue({ data: {} });
});

// Each role's area guarded the same way as in App.jsx; the other paths render
// a marker so the redirect target is visible.
function renderAt(route) {
  return renderWithProviders(
    <Routes>
      <Route path="/login" element={<p>login page</p>} />
      {Object.entries(ROLE_HOME).map(([role, path]) => (
        <Route key={role} path={path} element={<RequireRole role={role} />}>
          <Route index element={<p>{role} dashboard</p>} />
        </Route>
      ))}
    </Routes>,
    { route },
  );
}

describe('RequireRole', () => {
  test('signed out: redirects to /login', () => {
    renderAt('/supervisor');
    expect(screen.getByText('login page')).toBeInTheDocument();
  });

  test('expired token: redirects to /login', () => {
    tokenStore.set(fakeToken('supervisor', { exp: Math.floor(Date.now() / 1000) - 60 }));
    renderAt('/supervisor');
    expect(screen.getByText('login page')).toBeInTheDocument();
  });

  test.each([
    ['outgoing_staff', '/supervisor'],
    ['incoming_staff', '/admin'],
    ['supervisor', '/outgoing'],
    ['admin', '/incoming'],
  ])('%s visiting %s is sent to their own home', (role, route) => {
    tokenStore.set(fakeToken(role));
    renderAt(route);
    expect(screen.getByText(`${role} dashboard`)).toBeInTheDocument();
  });

  test.each(Object.entries(ROLE_HOME))('%s may open %s', (role, route) => {
    tokenStore.set(fakeToken(role));
    renderAt(route);
    expect(screen.getByText(`${role} dashboard`)).toBeInTheDocument();
  });
});
