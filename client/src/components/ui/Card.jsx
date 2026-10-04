import { cx } from '../../lib/format';

// Surface for a section of a screen. With `title`, renders a header row with
// an optional `actions` slot; `flush` drops body padding (for tables).
export default function Card({ title, subtitle, actions, icon: Icon, flush = false, className, bodyClassName, children, as: Tag = 'section', ...props }) {
  return (
    <Tag className={cx('rounded-xl border border-ink-200 bg-surface shadow-card [backdrop-filter:var(--card-blur,none)]', className)} {...props}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-ink-200 px-4 py-3 sm:px-5">
          <div className="flex min-w-0 items-start gap-2.5">
            {Icon && <Icon aria-hidden className="mt-0.5 size-[18px] shrink-0 text-ink-500" />}
            <div className="min-w-0">
              {title && <h2 className="text-section text-fg">{title}</h2>}
              {subtitle && <p className="text-meta text-ink-600">{subtitle}</p>}
            </div>
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cx(!flush && 'p-4 sm:p-5', bodyClassName)}>{children}</div>
    </Tag>
  );
}
