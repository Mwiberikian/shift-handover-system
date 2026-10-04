import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../../theme/ThemeContext';
import { cx } from '../../lib/format';

// Sun/moon switch for the dark header bars (app, landing, help, sign-in).
export default function ThemeToggle({ className }) {
  const { theme, toggle } = useTheme();
  const dark = theme === 'dark';
  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={dark}
      aria-label="Dark theme"
      title={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      className={cx('grid size-9 place-items-center rounded-lg text-white/80 transition-colors hover:bg-white/10 hover:text-white', className)}
    >
      {dark ? <Sun aria-hidden className="size-[18px]" /> : <Moon aria-hidden className="size-[18px]" />}
    </button>
  );
}
