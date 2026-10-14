import logoUrl from '../../assets/kenya-airways-logo.svg';
import { cx } from '../../lib/format';

// Airline logo plus the product name. `tone` sets the product-name colour for
// dark (header) or light (login, landing) backgrounds.
export default function Brand({ tone = 'dark', size = 'md', showName = true, className }) {
  return (
    <span className={cx('flex items-center gap-3 select-none', className)}>
      {/* width/height give the logo's aspect ratio (79.4 x 14.9 mm) so the
          header does not shift while it loads; CSS sets the drawn size. */}
      <img src={logoUrl} alt="Kenya Airways" width="160" height="30" className={size === 'lg' ? 'h-10 w-auto' : 'h-6 w-auto sm:h-7'} />
      {showName && (
        <>
          <span aria-hidden className={cx('h-6 w-px', tone === 'dark' ? 'bg-white/20' : 'bg-ink-300')} />
          <span className={cx('font-semibold tracking-tight whitespace-nowrap', size === 'lg' ? 'text-lg' : 'text-sm', tone === 'dark' ? 'text-white' : 'text-fg')}>
            Shift Handover
          </span>
        </>
      )}
    </span>
  );
}
