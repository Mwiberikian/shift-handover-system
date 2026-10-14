import { cx } from '../../lib/format';
import useMediaQuery, { PHONE_QUERY } from '../../lib/useMediaQuery';
import EmptyState from './EmptyState';
import { SkeletonTable } from './Skeleton';

// columns: [{ key, header, render?(row), className?, hideBelow?: 'sm'|'md'|'lg' }]
// With onRowClick, rows are focusable and open with Enter/Space as well as click.
// Below md (phones) each row becomes a card listing every column, hidden ones
// included, as label and value (Q4).
const HIDE = { sm: 'hidden sm:table-cell', md: 'hidden md:table-cell', lg: 'hidden lg:table-cell' };

export default function Table({
  columns, rows, rowKey, onRowClick, selectedKey, loading = false, empty, rowClassName, caption, rowLabel,
}) {
  const phone = useMediaQuery(PHONE_QUERY);
  if (loading) return <SkeletonTable cols={Math.min(columns.length, 5)} />;
  if (!rows?.length) return empty ?? <EmptyState compact title="Nothing here yet" />;

  const activate = (row) => (e) => {
    if (e.type === 'click' || e.key === 'Enter' || e.key === ' ') {
      if (e.key === ' ') e.preventDefault();
      onRowClick(row);
    }
  };

  if (phone) {
    return (
      <ul aria-label={caption} className="space-y-2">
        {rows.map((row) => {
          const key = rowKey(row);
          const selected = selectedKey != null && selectedKey === key;
          return (
            // The li stays a list item; a clickable row's card is a button inside it.
            <li key={key}>
              <div
                tabIndex={onRowClick ? 0 : undefined}
                role={onRowClick ? 'button' : undefined}
                aria-pressed={onRowClick ? selected : undefined}
                aria-label={onRowClick && rowLabel ? rowLabel(row) : undefined}
                onClick={onRowClick ? activate(row) : undefined}
                onKeyDown={onRowClick ? activate(row) : undefined}
                className={cx(
                  'rounded-lg border border-ink-200 bg-surface p-3 transition-colors',
                  onRowClick && 'min-h-11 cursor-pointer active:bg-ink-50 focus-visible:bg-ink-50',
                  selected && 'border-ink-300 bg-ink-100/80 shadow-[inset_3px_0_0_var(--color-brand-red)]',
                  rowClassName?.(row),
                )}
              >
                {/* Each field is label + value on one line, wrapping the value onto its
                    own line when it is too wide to sit beside the label. */}
                <dl className="space-y-1.5">
                  {columns.filter((c) => c.header).map((c) => (
                    <div key={c.key} className="flex flex-wrap items-start gap-x-3 gap-y-0.5">
                      <dt className="w-28 shrink-0 pt-0.5 text-meta font-semibold tracking-wide text-ink-600 uppercase">{c.header}</dt>
                      <dd className="max-w-full flex-1 basis-32 break-words">{c.render ? c.render(row) : row[c.key]}</dd>
                    </div>
                  ))}
                </dl>
                {/* Columns without a header (row actions) go below, full width. */}
                {columns.filter((c) => !c.header).map((c) => (
                  <div key={c.key} className="pt-2">{c.render ? c.render(row) : row[c.key]}</div>
                ))}
              </div>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <div className="relative overflow-x-auto">
      <table className="w-full border-collapse text-left text-body">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr className="border-b border-ink-200 bg-ink-50/80">
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={cx('px-4 py-2.5 text-meta font-semibold tracking-wide text-ink-600 uppercase whitespace-nowrap', HIDE[c.hideBelow], c.className)}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-100">
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
                  onRowClick && 'cursor-pointer hover:bg-ink-50 focus-visible:bg-ink-50 focus-visible:outline-offset-[-2px]',
                  selected && 'bg-ink-100/80 shadow-[inset_3px_0_0_var(--color-brand-red)] hover:bg-ink-100',
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
