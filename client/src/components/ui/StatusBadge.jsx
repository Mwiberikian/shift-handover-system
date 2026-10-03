import {
  AlertOctagon, AlertTriangle, ArrowDown, ArrowUp, CheckCircle2, Circle, CircleDot, Eye, FilePen, HelpCircle,
  Lock, Minus, Send,
} from 'lucide-react';
import { cx } from '../../lib/format';

export const TONES = {
  gray: 'bg-status-gray-soft text-status-gray ring-status-gray-line',
  blue: 'bg-status-blue-soft text-status-blue ring-status-blue-line',
  amber: 'bg-status-amber-soft text-status-amber ring-status-amber-line',
  green: 'bg-status-green-soft text-status-green ring-status-green-line',
  red: 'bg-status-red-soft text-status-red ring-status-red-line',
  'red-solid': 'bg-brand-red-dark text-white ring-brand-red-dark',
  dark: 'bg-zinc-800 text-white ring-zinc-800',
};

// Every enum value the API returns, mapped to tone + label + icon. The icon
// means status never relies on colour alone.
const MAPS = {
  record: {
    draft: ['gray', 'Draft', FilePen],
    submitted: ['blue', 'Submitted', Send],
    queried: ['amber', 'Queried', HelpCircle],
    acknowledged: ['green', 'Acknowledged', CheckCircle2],
    under_review: ['amber', 'Under review', Eye],
    escalated: ['red', 'Escalated', AlertTriangle],
    closed: ['green', 'Closed', Lock],
  },
  task: {
    open: ['gray', 'Open', Circle],
    in_progress: ['amber', 'In progress', CircleDot],
    resolved: ['green', 'Resolved', CheckCircle2],
  },
  priority: {
    low: ['gray', 'Low', ArrowDown],
    medium: ['amber', 'Medium', Minus],
    high: ['red', 'High', ArrowUp],
  },
  severity: {
    low: ['gray', 'Low', Circle],
    medium: ['amber', 'Medium', AlertTriangle],
    high: ['red', 'High', AlertTriangle],
    critical: ['red-solid', 'Critical', AlertOctagon],
  },
};

export function Badge({ tone = 'gray', icon: Icon, className, children }) {
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-meta font-medium whitespace-nowrap ring-1 ring-inset', TONES[tone], className)}>
      {Icon && <Icon aria-hidden className="size-3 shrink-0" />}
      {children}
    </span>
  );
}

// kind: record (default) | task | priority | severity
export default function StatusBadge({ kind = 'record', value, status, className }) {
  const v = value ?? status;
  const [tone, label, icon] = MAPS[kind]?.[v] ?? ['gray', v?.replace(/_/g, ' ') ?? '—', null];
  const prefix = kind === 'priority' ? 'Priority: ' : kind === 'severity' ? 'Severity: ' : '';
  return (
    <Badge tone={tone} icon={icon} className={className}>
      {prefix && <span className="sr-only">{prefix}</span>}
      {label}
    </Badge>
  );
}

// Options for <select>s built from the same source of truth.
export const optionsFor = (kind) => Object.entries(MAPS[kind]).map(([value, [, label]]) => ({ value, label }));
