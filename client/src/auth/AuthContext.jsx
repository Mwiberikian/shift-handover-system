import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import api, { decodeToken, tokenStore } from '../api';

const AuthContext = createContext(null);

export const ROLE_HOME = {
  outgoing_staff: '/outgoing',
  incoming_staff: '/incoming',
  supervisor: '/supervisor',
  admin: '/admin',
};

function claimsFromStore() {
  const token = tokenStore.get();
  const claims = token && decodeToken(token);
  if (!claims || claims.exp * 1000 < Date.now()) {
    tokenStore.clear();
    return null;
  }
  return claims;
}

export function AuthProvider({ children }) {
  const [claims, setClaims] = useState(claimsFromStore);
  const [profile, setProfile] = useState(null);

  const logout = useCallback(() => {
    tokenStore.clear();
    setClaims(null);
    setProfile(null);
  }, []);

  useEffect(() => {
    window.addEventListener('shms:logout', logout);
    return () => window.removeEventListener('shms:logout', logout);
  }, [logout]);

  useEffect(() => {
    if (claims && !profile) api.get('/auth/me').then((r) => setProfile(r.data)).catch(() => {});
  }, [claims, profile]);

  const login = useCallback(async (identifier, password) => {
    const { data } = await api.post('/auth/login', { identifier, password });
    tokenStore.set(data.token);
    setClaims(decodeToken(data.token));
    setProfile(data.user);
    return decodeToken(data.token);
  }, []);

  // Google sign-in: the server verifies the ID token and only signs in to an
  // existing account. A 404 { code: 'no_account' } is rethrown to the caller.
  const loginWithGoogle = useCallback(async (credential) => {
    const { data } = await api.post('/auth/google', { credential });
    tokenStore.set(data.token);
    setClaims(decodeToken(data.token));
    setProfile(data.user);
    return decodeToken(data.token);
  }, []);

  const value = useMemo(() => ({
    claims, profile, login, loginWithGoogle, logout,
  }), [claims, profile, login, loginWithGoogle, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
