import { Dialog, DialogBackdrop, DialogPanel, DialogTitle, Description } from '@headlessui/react';
import { AlertTriangle, X } from 'lucide-react';
import { cx } from '../../lib/format';
import Button from './Button';

// Accessible modal: focus is trapped, Escape and backdrop click close it.
export function Modal({ open, onClose, title, description, children, footer, size = 'md' }) {
  return (
    <Dialog open={open} onClose={onClose} className="relative z-50">
      <DialogBackdrop transition className="fixed inset-0 bg-brand-black/40 transition-opacity dark:bg-black/65 duration-200 data-closed:opacity-0" />
      <div className="fixed inset-0 flex items-end justify-center overflow-y-auto p-3 sm:items-center sm:p-6">
        <DialogPanel
          transition
          className={cx(
            'w-full rounded-xl bg-surface shadow-pop ring-1 ring-transparent dark:ring-white/10 transition duration-200 ease-out data-closed:translate-y-2 data-closed:opacity-0 data-closed:sm:scale-95 data-closed:sm:translate-y-0',
            size === 'lg' ? 'max-w-2xl' : 'max-w-md',
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-ink-200 px-5 py-4">
            <div>
              <DialogTitle className="text-section text-fg">{title}</DialogTitle>
              {description && <Description className="mt-0.5 text-ink-600">{description}</Description>}
            </div>
            <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close" className="-mt-1 -mr-2 size-8" icon={X} />
          </div>
          {children && <div className="px-5 py-4">{children}</div>}
          {footer && <div className="flex flex-col-reverse gap-2 border-t border-ink-200 bg-ink-50/60 px-5 py-3 sm:flex-row sm:justify-end rounded-b-xl">{footer}</div>}
        </DialogPanel>
      </div>
    </Dialog>
  );
}

// Confirmation step for consequential actions. `tone="danger"` styles the
// confirm button as destructive.
export function ConfirmDialog({
  open, onClose, onConfirm, title, message, confirmLabel = 'Confirm', tone = 'primary', loading = false, icon: Icon, children,
}) {
  const IconCmp = Icon ?? (tone === 'danger' ? AlertTriangle : null);
  return (
    <Modal
      open={open}
      onClose={loading ? () => {} : onClose}
      title={title}
      footer={(
        <>
          {/* Focus starts on Cancel so a stray Enter can't confirm a consequential action. */}
          <Button variant="secondary" onClick={onClose} disabled={loading} data-autofocus>Cancel</Button>
          <Button variant={tone === 'danger' ? 'danger-solid' : 'primary'} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      )}
    >
      <div className="flex gap-3">
        {IconCmp && (
          <span className={cx('grid size-9 shrink-0 place-items-center rounded-full', tone === 'danger' ? 'bg-status-red-soft text-status-red' : 'bg-ink-100 text-ink-700')}>
            <IconCmp aria-hidden className="size-[18px]" />
          </span>
        )}
        <div className="min-w-0 flex-1 text-ink-700">
          {message}
          {children}
        </div>
      </div>
    </Modal>
  );
}
