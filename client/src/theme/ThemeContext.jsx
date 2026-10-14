import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

// Theme preference: 'light', 'dark' or 'system' (follow the OS, live).
// index.html applies the cached choice before first paint (no flash); this
// keeps <html class="dark"> in sync afterwards. Signed in, the preference is
// also kept on the server (R1, lib/preferences.js) and applied at sign-in, so
// the same user sees the same theme on every device. The local copy is a
// cache for the next first paint.
export const THEME_KEY = 'shms-theme';
export const THEME_PREFERENCES = ['light', 'dark', 'system'];
const media = () => window.matchMedia('(prefers-color-scheme: dark)');

function stored() {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === 'dark' || v === 'light' ? v : 'system';
  } catch {
    return 'system';
  }
}

function cache(preference) {
  try {
    if (preference === 'system') localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, preference);
  } catch { /* private mode: in-memory only */ }
}

const ThemeContext = createContext({
  theme: 'light', preference: 'system', toggle: () => 'light', setPreference: () => {},
});

export function ThemeProvider({ children }) {
  const [preference, setPreferenceState] = useState(stored);
  const [osDark, setOsDark] = useState(() => media().matches);
  const theme = preference === 'system' ? (osDark ? 'dark' : 'light') : preference;

  useEffect(() => {
    const mq = media();
    const onChange = (e) => setOsDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', theme === 'dark');
    root.style.colorScheme = theme;
  }, [theme]);

  const setPreference = useCallback((next) => {
    if (!THEME_PREFERENCES.includes(next)) return;
    setPreferenceState(next);
    cache(next);
  }, []);

  // Switches to the other theme as an explicit choice; returns it.
  const toggle = useCallback(() => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setPreference(next);
    return next;
  }, [theme, setPreference]);

  const value = useMemo(() => ({
    theme, preference, toggle, setPreference,
  }), [theme, preference, toggle, setPreference]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
