import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

// Theme preference. index.html applies it before first paint (no flash); this
// keeps <html class="dark"> in sync afterwards. With no stored choice the OS
// preference is used and followed live.
export const THEME_KEY = 'shms-theme';
const media = () => window.matchMedia('(prefers-color-scheme: dark)');

function stored() {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === 'dark' || v === 'light' ? v : null;
  } catch {
    return null;
  }
}

const ThemeContext = createContext({ theme: 'light', toggle: () => {} });

export function ThemeProvider({ children }) {
  const [choice, setChoice] = useState(stored);
  const [osDark, setOsDark] = useState(() => media().matches);
  const theme = choice ?? (osDark ? 'dark' : 'light');

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

  const toggle = useCallback(() => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setChoice(next);
    try { localStorage.setItem(THEME_KEY, next); } catch { /* private mode: in-memory only */ }
  }, [theme]);

  const value = useMemo(() => ({ theme, toggle }), [theme, toggle]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
