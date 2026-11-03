import { Link } from 'react-router-dom';
import { cx } from '../../lib/format';
import { useScrolledPast } from '../../lib/useReveal';
import Brand from './Brand';
import HelpMenu from './HelpMenu';
import ThemeToggle from './ThemeToggle';
import UtilityBar from './UtilityBar';
import EntryButton from './EntryButton';

// Fixed chrome for the public pages (landing, help): utility bar + glass bar.
// Content beneath it needs pt-27 (2.75rem bar + 4rem header).
// `condense`: after 24 px of scrolling the bar gains a shadow and shrinks to
// 3.5rem. Done with transforms only (the glass scales, the row moves up), so
// the header's box and everything under it stay put: no layout shift.
export default function PublicHeader({ condense = false, children }) {
  const scrolled = useScrolledPast(24);
  const small = condense && scrolled;
  return (
    <div className="safe-top safe-x fixed inset-x-0 top-0 z-40">
      <UtilityBar />
      <header className="relative isolate">
        <div
          aria-hidden
          className={cx(
            'glass-dark absolute inset-0 -z-10 origin-top border-b border-white/10 transition-[scale,box-shadow] duration-300 ease-out',
            small && 'scale-y-[0.875] shadow-pop',
          )}
        />
        <div className={cx('mx-auto flex h-16 max-w-screen-xl items-center justify-between gap-4 px-4 transition-[translate] duration-300 ease-out sm:px-6 lg:px-8', small && '-translate-y-1')}>
          <Link to="/" aria-label="Shift Handover home" className="inline-flex min-h-11 min-w-11 items-center rounded-md">
            <Brand showName={false} className="sm:hidden" />
            <Brand className="hidden sm:flex" />
          </Link>
          <nav aria-label="Primary" className="flex items-center gap-1 sm:gap-3">
            {children}
            <ThemeToggle />
            <div className="hidden sm:block"><HelpMenu /></div>
            <EntryButton className="ml-1" />
          </nav>
        </div>
      </header>
    </div>
  );
}
