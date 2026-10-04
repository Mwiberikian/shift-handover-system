import { forwardRef, useId } from 'react';
import { AlertCircle, ChevronDown } from 'lucide-react';
import { cx } from '../../lib/format';

const CONTROL = 'block w-full rounded-lg border bg-surface px-3 text-body text-fg shadow-sm transition-colors placeholder:text-ink-500 '
  + 'focus:outline-none focus-visible:outline-none focus:ring-2 focus:ring-brand-red/25 focus:border-brand-red-dark '
  + 'disabled:cursor-not-allowed disabled:bg-ink-50 disabled:text-ink-500 read-only:bg-ink-50 read-only:text-ink-700';

const borderFor = (error) => (error ? 'border-status-red focus:border-status-red focus:ring-status-red/20' : 'border-ink-300 hover:border-ink-400');

// Label + control + hint/error wrapper. Children receive the generated id and
// aria wiring through the render prop. `error={true}` marks the control
// invalid without printing a message (e.g. when a form-level message covers it).
export function Field({ label, hint, error, required, className, children, hideLabel = false }) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const hasMessage = error && error !== true;
  const errorId = hasMessage ? `${id}-error` : undefined;
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      {label && (
        <label htmlFor={id} className={cx('text-sm font-medium text-ink-800', hideLabel && 'sr-only')}>
          {label}
          {required && <span aria-hidden className="ml-0.5 text-accent-fg">*</span>}
          {required && <span className="sr-only"> (required)</span>}
        </label>
      )}
      {children({
        id,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': [errorId, hintId].filter(Boolean).join(' ') || undefined,
        required,
      })}
      {hasMessage && (
        <p id={errorId} className="flex items-start gap-1 text-meta text-status-red">
          <AlertCircle aria-hidden className="mt-px size-3.5 shrink-0" />{error}
        </p>
      )}
      {hint && !error && <p id={hintId} className="text-meta text-ink-600">{hint}</p>}
    </div>
  );
}

export const Input = forwardRef(function Input({ label, hint, error, required, className, hideLabel, inputClassName, ...props }, ref) {
  return (
    <Field label={label} hint={hint} error={error} required={required} className={className} hideLabel={hideLabel}>
      {(a11y) => <input ref={ref} {...a11y} {...props} className={cx(CONTROL, 'h-9', borderFor(error), inputClassName)} />}
    </Field>
  );
});

export const Textarea = forwardRef(function Textarea({ label, hint, error, required, className, hideLabel, rows = 4, ...props }, ref) {
  return (
    <Field label={label} hint={hint} error={error} required={required} className={className} hideLabel={hideLabel}>
      {(a11y) => <textarea ref={ref} rows={rows} {...a11y} {...props} className={cx(CONTROL, 'resize-y py-2', borderFor(error))} />}
    </Field>
  );
});

// options: [{ value, label }] or strings; `placeholder` adds an empty first option.
export const Select = forwardRef(function Select({ label, hint, error, required, className, hideLabel, options = [], placeholder, children, ...props }, ref) {
  return (
    <Field label={label} hint={hint} error={error} required={required} className={className} hideLabel={hideLabel}>
      {(a11y) => (
        <div className="relative">
          <select ref={ref} {...a11y} {...props} className={cx(CONTROL, 'h-9 appearance-none pr-9', borderFor(error))}>
            {placeholder !== undefined && <option value="">{placeholder}</option>}
            {options.map((o) => {
              const opt = typeof o === 'string' ? { value: o, label: o } : o;
              return <option key={opt.value} value={opt.value}>{opt.label}</option>;
            })}
            {children}
          </select>
          <ChevronDown aria-hidden className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-ink-500" />
        </div>
      )}
    </Field>
  );
});

export function Checkbox({ label, description, className, ...props }) {
  const id = useId();
  return (
    <div className={cx('flex items-start gap-2.5', className)}>
      <input
        id={id}
        type="checkbox"
        {...props}
        className="mt-0.5 size-4 shrink-0 cursor-pointer rounded border-ink-300 accent-brand-red-dark disabled:cursor-not-allowed"
      />
      {(label || description) && (
        <label htmlFor={id} className="cursor-pointer text-sm leading-tight">
          <span className="font-medium text-ink-800">{label}</span>
          {description && <span className="block text-meta text-ink-600">{description}</span>}
        </label>
      )}
    </div>
  );
}
