import { cx } from '../../lib/format';

export default function Skeleton({ className }) {
  return <div aria-hidden className={cx('animate-pulse rounded-md bg-ink-200/80', className)} />;
}

// Placeholder for a table body while rows load.
export function SkeletonTable({ rows = 4, cols = 5 }) {
  return (
    <div role="status" aria-label="Loading" className="divide-y divide-ink-100">
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex items-center gap-4 px-4 py-3.5">
          {Array.from({ length: cols }, (__, c) => (
            <Skeleton key={c} className={cx('h-3.5', c === 0 ? 'w-1/4' : 'flex-1')} />
          ))}
        </div>
      ))}
    </div>
  );
}

// Placeholder for a card of text content.
export function SkeletonCard({ lines = 4, className }) {
  return (
    <div role="status" aria-label="Loading" className={cx('rounded-xl border border-ink-200 bg-surface p-5 shadow-card', className)}>
      <Skeleton className="mb-4 h-4 w-1/3" />
      <div className="space-y-2.5">
        {Array.from({ length: lines }, (_, i) => <Skeleton key={i} className={cx('h-3', i === lines - 1 ? 'w-2/3' : 'w-full')} />)}
      </div>
    </div>
  );
}

// Row of stat-card placeholders.
export function SkeletonStats({ count = 4 }) {
  return (
    <div role="status" aria-label="Loading" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="rounded-xl border border-ink-200 bg-surface p-4 shadow-card">
          <Skeleton className="h-3 w-1/2" />
          <Skeleton className="mt-3 h-7 w-1/3" />
        </div>
      ))}
    </div>
  );
}
