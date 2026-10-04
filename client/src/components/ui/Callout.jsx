import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import { cx } from '../../lib/format';

const TONES = {
  info: ['border-status-blue-line bg-status-blue-soft text-status-blue', Info],
  warning: ['border-status-amber-line bg-status-amber-soft text-status-amber', AlertTriangle],
  danger: ['border-status-red-line bg-status-red-soft text-status-red', XCircle],
  success: ['border-status-green-line bg-status-green-soft text-status-green', CheckCircle2],
};

// Persistent inline message for page state (not transient feedback — that's a toast).
export default function Callout({ tone = 'info', title, children, action, icon, className }) {
  const [classes, DefaultIcon] = TONES[tone];
  const Icon = icon ?? DefaultIcon;
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={cx('flex gap-3 rounded-xl border px-4 py-3', classes, className)}>
      <Icon aria-hidden className="mt-0.5 size-[18px] shrink-0" />
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={cx('text-ink-800', title && 'mt-0.5')}>{children}</div>}
      </div>
      {action && <div className="shrink-0 self-center">{action}</div>}
    </div>
  );
}
