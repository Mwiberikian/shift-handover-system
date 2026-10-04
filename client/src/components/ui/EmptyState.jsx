import { Inbox } from 'lucide-react';
import { cx } from '../../lib/format';

export default function EmptyState({ icon: Icon = Inbox, title, message, action, className, compact = false }) {
  return (
    <div className={cx('flex flex-col items-center justify-center text-center', compact ? 'gap-1.5 px-4 py-8' : 'gap-2 px-6 py-14', className)}>
      <span className={cx('grid place-items-center rounded-full bg-ink-100 text-ink-500', compact ? 'size-10' : 'size-12')}>
        <Icon aria-hidden className={compact ? 'size-5' : 'size-6'} />
      </span>
      {title && <p className="mt-1 font-semibold text-fg">{title}</p>}
      {message && <p className="max-w-sm text-ink-600">{message}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
