import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from '@headlessui/react';
import { X } from 'lucide-react';
import Button from './Button';

// Right-hand slide-over for record detail. Escape / backdrop click close it.
export default function Drawer({ open, onClose, title, children, footer }) {
  return (
    <Dialog open={open} onClose={onClose} className="relative z-50">
      <DialogBackdrop transition className="fixed inset-0 bg-brand-black/30 transition-opacity dark:bg-black/60 duration-200 data-closed:opacity-0" />
      <div className="fixed inset-y-0 right-0 flex w-full max-w-2xl">
        <DialogPanel
          transition
          className="flex w-full flex-col bg-surface shadow-pop dark:border-l dark:border-white/10 transition duration-250 ease-out data-closed:translate-x-full"
        >
          <div className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-ink-200 px-4 sm:px-6">
            <DialogTitle className="truncate text-section text-fg">{title}</DialogTitle>
            <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close panel" icon={X} />
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-6">{children}</div>
          {footer && <div className="shrink-0 border-t border-ink-200 bg-ink-50/60 px-4 py-3 sm:px-6">{footer}</div>}
        </DialogPanel>
      </div>
    </Dialog>
  );
}
