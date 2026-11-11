// Phase 2: how a record's release decision is shown, on every detail view.
//
// - held:           a clear banner with the reasons. The reader can still act
//                   on the handover — a hold never blocks the next shift.
// - auto_released:  "Released automatically: checks passed", with the date.
// - approved:       released by a supervisor, with the date.
// Records from before the feature have no release_state and show nothing.
import { ShieldAlert, ShieldCheck } from 'lucide-react';
import { Callout } from './ui';
import { formatEAT } from '../lib/format';

export default function ReleaseBanner({ record }) {
  if (!record?.release_state) return null;

  if (record.release_state === 'held') {
    const reasons = record.release_reasons || [];
    return (
      <Callout tone="warning" icon={ShieldAlert} title="Held for approval">
        <p>This report was not released automatically. A supervisor has been notified and will approve it or send it back.</p>
        {reasons.length > 0 && (
          <ul className="mt-1.5 list-disc space-y-0.5 pl-5">
            {reasons.map((r) => <li key={r.text}>{r.text}</li>)}
          </ul>
        )}
        <p className="mt-1.5">You can still read and acknowledge it as usual — a hold never blocks the next shift.</p>
      </Callout>
    );
  }

  const label = record.release_state === 'approved'
    ? 'Approved by a supervisor'
    : 'Released automatically: checks passed';
  return (
    <p className="flex items-center gap-1.5 rounded-lg border border-status-green-line bg-status-green-soft px-3 py-2 text-meta font-medium text-status-green">
      <ShieldCheck aria-hidden className="size-4 shrink-0" />
      {label}{record.released_at && <> · {formatEAT(record.released_at)}</>}
    </p>
  );
}
