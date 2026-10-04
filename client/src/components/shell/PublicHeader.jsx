import { Link } from 'react-router-dom';
import Brand from './Brand';
import HelpMenu from './HelpMenu';
import ThemeToggle from './ThemeToggle';
import UtilityBar from './UtilityBar';
import EntryButton from './EntryButton';

// Fixed chrome for the public pages (landing, help): utility bar + glass bar.
// Content beneath it needs pt-24 (2rem bar + 4rem header).
export default function PublicHeader({ children }) {
  return (
    <div className="fixed inset-x-0 top-0 z-40">
      <UtilityBar />
      <header className="glass-dark border-b border-white/10">
        <div className="mx-auto flex h-16 max-w-screen-xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <Link to="/" aria-label="Shift Handover home" className="rounded-md">
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
