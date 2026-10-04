import { forwardRef } from 'react';
import { Link } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { cx } from '../../lib/format';

const VARIANTS = {
  primary: 'bg-brand-red-dark text-white shadow-sm hover:bg-brand-red-darker disabled:bg-ink-300 disabled:text-ink-600',
  secondary: 'border border-ink-300 bg-surface text-fg shadow-sm hover:bg-ink-50 hover:border-ink-400 disabled:text-ink-500 disabled:bg-ink-50',
  danger: 'border border-status-red-line bg-surface text-status-red shadow-sm hover:bg-status-red-soft hover:border-status-red disabled:text-ink-500 disabled:border-ink-200',
  'danger-solid': 'bg-brand-red-dark text-white shadow-sm hover:bg-brand-red-darker disabled:bg-ink-300 disabled:text-ink-600',
  ghost: 'bg-transparent text-ink-700 hover:bg-ink-100 hover:text-fg disabled:text-ink-400',
};

const SIZES = {
  sm: 'h-8 gap-1.5 px-2.5 text-meta',
  md: 'h-9 gap-2 px-3.5 text-body',
  lg: 'h-11 gap-2 px-5 text-body',
  icon: 'size-9 justify-center',
};

// Class string for anything that should look like a Button (e.g. a Link).
export const buttonClass = ({ variant = 'secondary', size = 'md', className } = {}) => cx(
  'inline-flex shrink-0 items-center justify-center rounded-lg font-medium whitespace-nowrap transition-colors duration-150 disabled:cursor-not-allowed',
  VARIANTS[variant],
  SIZES[size],
  className,
);

const Button = forwardRef(function Button(
  { variant = 'secondary', size = 'md', loading = false, icon: Icon, className, children, disabled, type = 'button', ...props },
  ref,
) {
  const iconSize = size === 'sm' ? 'size-3.5' : 'size-4';
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClass({ variant, size, className })}
      {...props}
    >
      {loading
        ? <Loader2 aria-hidden className={cx(iconSize, 'animate-spin')} />
        : Icon && <Icon aria-hidden className={iconSize} />}
      {children}
    </button>
  );
});

// Router link styled as a Button.
export function ButtonLink({ to, variant = 'secondary', size = 'md', icon: Icon, className, children, ...props }) {
  return (
    <Link to={to} className={buttonClass({ variant, size, className })} {...props}>
      {Icon && <Icon aria-hidden className={size === 'sm' ? 'size-3.5' : 'size-4'} />}
      {children}
    </Link>
  );
}

export default Button;
