import { NavLink } from 'react-router-dom';
import { cx } from '../../lib/format';
import { useUnreadMessages } from '../../lib/unread';

// Role nav. `compact` renders the icon-only rail used on mid-width screens.
export default function SidebarNav({ items, compact = false, onNavigate }) {
  const unread = useUnreadMessages();
  return (
    <nav aria-label="Main" className="flex flex-col gap-1 p-3">
      {items.map(({
        to, end, label, icon: Icon, badge,
      }) => {
        const count = badge === 'messages' ? unread : 0;
        const name = count ? `${label}, ${count} unread` : label;
        return (
        <NavLink
          key={to}
          to={to}
          end={end}
          onClick={onNavigate}
          title={compact ? name : undefined}
          aria-label={compact || count ? name : undefined}
          className={({ isActive }) => cx(
            'group relative flex items-center gap-3 rounded-lg px-3 py-2 text-body font-medium transition-colors',
            compact && 'justify-center px-0',
            isActive
              ? 'bg-ink-100 text-fg'
              : 'text-ink-600 hover:bg-ink-50 hover:text-fg',
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
              <Icon aria-hidden className={cx('size-[18px] shrink-0', isActive ? 'text-accent-fg' : 'text-ink-500 group-hover:text-ink-700')} />
              {!compact && <span className="truncate">{label}</span>}
              {count > 0 && (
                compact
                  ? <span aria-hidden className="absolute top-1 right-2 size-2 rounded-full bg-brand-red ring-2 ring-surface" />
                  : <span aria-hidden className="ml-auto rounded-full bg-brand-red-dark px-1.5 text-meta font-semibold text-white tabular-nums">{count > 99 ? '99+' : count}</span>
              )}
            </>
          )}
        </NavLink>
        );
      })}
    </nav>
  );
}
