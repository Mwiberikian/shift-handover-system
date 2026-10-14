import { useEffect } from 'react';
import api from '../api';
import { useAuth } from '../auth/AuthContext';
import { useTheme } from '../theme/ThemeContext';

// Cross-device preferences (R1). The server keeps theme_preference and
// email_notifications per user. Sign-in and /auth/me return them; the theme is
// applied and cached locally (ThemeContext), so the same user sees the same
// theme on web and phone. Email alerts take effect on the server and show in
// the account menu from the profile.

// Mounted once inside AuthProvider: applies the signed-in user's saved theme
// whenever the profile arrives (sign-in, reload) or changes.
export function PreferenceSync() {
  const { profile } = useAuth() ?? {};
  const { setPreference } = useTheme();
  const saved = profile?.theme_preference;
  useEffect(() => {
    if (saved) setPreference(saved);
  }, [profile?.user_id, saved, setPreference]);
  return null;
}

// The theme switch for headers and menus. Signed in, the choice is saved to
// the server too; signed out it stays on this device.
export function useThemeSwitch() {
  const { theme, toggle } = useTheme();
  const auth = useAuth();
  const save = async (theme_preference) => {
    if (!auth?.claims || auth.claims.pwd_change) return;
    try {
      const { data } = await api.patch('/auth/me/preferences', { theme_preference });
      auth.updateProfile(data);
    } catch {
      // Kept on this device; the next change or sign-in tries again.
    }
  };
  return {
    theme,
    toggle: () => save(toggle()),
  };
}
