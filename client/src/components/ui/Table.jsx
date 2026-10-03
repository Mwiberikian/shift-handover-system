import { cx } from '../../lib/format';
import EmptyState from './EmptyState';
import { SkeletonTable } from './Skeleton';

// columns: [{ key, header, render?(row), className?, hideBelow?: 'sm'|'md'|'lg' }]
// With onRowClick, rows are focusable and open with Enter/Space as well as click.
const HIDE = { sm: 'hidden sm:table-cell', md: 'hidden md:table-cell', lg: 'hidden lg:table-cell' };

export default function Table({
  columns, rows, rowKey, onRowClick, selectedKey, loading = false, empty, rowClassName, caption, rowLabel,
}) {
  if (loading) return <SkeletonTable cols={Math.min(columns.length, 5)} />;
  if (!rows?.length) return empty ?? <EmptyState compact title="Nothing here yet" />;

  const activate = (row) => (e) => {
    if (e.type === 'click' || e.key === 'Enter' || e.key === ' ') {
      if (e.key === ' ') e.preventDefault();
      onRowClick(row);
    }
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-body">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr className="border-b border-zinc-200 bg-zinc-50/80">
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={cx('px-4 py-2.5 text-meta font-semibold tracking-wide text-zinc-600 uppercase whitespace-nowrap', HIDE[c.hideBelow], c.className)}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {rows.map((row) => {
            const key = rowKey(row);
            const selected = selectedKey != null && selectedKey === key;
            return (
              <tr
                key={key}
                tabIndex={onRowClick ? 0 : undefined}
                aria-selected={onRowClick ? selected : undefined}
                aria-label={onRowClick && rowLabel ? rowLabel(row) : undefined}
                onClick={onRowClick ? activate(row) : undefined}
                onKeyDown={onRowClick ? activate(row) : undefined}
                className={cx(
                  'transition-colors',
                  onRowClick && 'cursor-pointer hover:bg-zinc-50 focus-visible:bg-zinc-50 focus-visible:outline-offset-[-2px]',
                  selected && 'bg-zinc-100/80 shadow-[inset_3px_0_0_var(--color-brand-red)] hover:bg-zinc-100',
                  rowClassName?.(row),
                )}
              >
                {columns.map((c) => (
                  <td key={c.key} className={cx('px-4 py-3 align-middle', HIDE[c.hideBelow], c.className)}>
                    {c.render ? c.render(row) : row[c.key]}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
