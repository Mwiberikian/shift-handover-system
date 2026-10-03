import { NavLink } from 'react-router-dom';
import { cx } from '../../lib/format';

// Role nav. `compact` renders the icon-only rail used on mid-width screens.
export default function SidebarNav({ items, compact = false, onNavigate }) {
  return (
    <nav aria-label="Main" className="flex flex-col gap-1 p-3">
      {items.map(({ to, end, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          onClick={onNavigate}
          title={compact ? label : undefined}
          aria-label={compact ? label : undefined}
          className={({ isActive }) => cx(
            'group relative flex items-center gap-3 rounded-lg px-3 py-2 text-body font-medium transition-colors',
            compact && 'justify-center px-0',
            isActive
              ? 'bg-zinc-100 text-brand-black'
              : 'text-zinc-600 hover:bg-zinc-50 hover:text-brand-black',
          )}
        >
          {({ isActive }) => (
            <>
              <span
                aria-hidden
                className={cx(
                  'absolute inset-y-1.5 left-0 w-1 rounded-full bg-brand-red transition-opacity',
                  isActive ? 'opacity-100' : 'opacity-0',
                )}
              />
              <Icon aria-hidden className={cx('size-[18px] shrink-0', isActive ? 'text-brand-red-dark' : 'text-zinc-500 group-hover:text-zinc-700')} />
              {!compact && <span className="truncate">{label}</span>}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}
