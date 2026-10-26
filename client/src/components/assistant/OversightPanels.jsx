import { useEffect, useState } from 'react';
import { FileSearch, Gauge, Repeat2, Search as SearchIcon } from 'lucide-react';
import api from '../../api';
import {
  Badge, Button, Card, EmptyState, Input, SkeletonCard,
} from '../ui';
import { formatEAT, shiftLabel } from '../../lib/format';
import useAction from '../../lib/useAction';
import { logAssistantEvent, useAssistantData } from './useAssistant';

const LEVEL_TONE = { high: 'red', medium: 'amber', low: 'gray' };

// Handovers ranked by how much they need a supervisor, with the reasons.
export function AttentionList({ onOpen }) {
  const { data, loading } = useAssistantData('/assistant/attention', [], { params: { limit: 8 } });
  if (loading) return <SkeletonCard lines={3} />;
  const items = data?.items ?? [];
  return (
    <Card title="Needs attention first" subtitle="Ranked by a transparent score. Each reason shows its points." icon={Gauge} flush>
      {items.length === 0 ? (
        <EmptyState icon={Gauge} title="Nothing stands out" message="No recent handover has enough risk signals to rank." />
      ) : (
        <ul className="divide-y divide-ink-200">
          {items.map((i) => (
            <li key={i.record_id}>
              <button type="button" onClick={() => onOpen(i.record_id)} className="flex min-h-11 w-full flex-col gap-1 px-4 py-3 text-left hover:bg-ink-50 sm:px-5">
                <span className="flex flex-wrap items-center gap-2">
                  <Badge tone={LEVEL_TONE[i.level] ?? 'gray'}>{i.level} · {i.score}</Badge>
                  <span className="font-medium text-fg">{i.department_name} · {shiftLabel(i)}</span>
                  <span className="text-meta text-ink-600">{formatEAT(i.shift_start, 'date')} · {i.outgoing_name}</span>
                </span>
                <span className="text-meta text-ink-700">
                  {i.reasons.slice(0, 3).map((r) => `${r.text} (+${r.points})`).join(' · ')}
                </span>
                {i.flags.length > 0 && <span className="text-meta text-ink-600">Quality: {i.flags.map((f) => f.message).join(' ')}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// Issues that keep coming back across handovers.
export function RecurringClusters() {
  const { data, loading } = useAssistantData('/assistant/recurring', []);
  if (loading) return <SkeletonCard lines={3} />;
  const clusters = data?.clusters ?? [];
  if (!clusters.length) return null;
  return (
    <Card title="Recurring issues" subtitle={`Same problem in several handovers, last ${data.window_days} days`} icon={Repeat2}>
      <ul className="space-y-2">
        {clusters.slice(0, 5).map((c) => (
          <li key={c.label} className="rounded-lg bg-ink-50 px-3 py-2 text-ink-800">
            <strong className="text-fg">“{c.label}”</strong>
            <span className="ml-2 text-meta text-ink-600">in {c.occurrences} handovers</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

// Search by meaning: related wording and aviation terms match too.
export function MeaningSearch({ onOpen }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState(null);
  const [run, busy] = useAction();
  const submit = (e) => {
    e.preventDefault();
    if (q.trim().length < 2) return;
    run(async () => {
      const res = await api.get('/assistant/search', { params: { q: q.trim() } });
      setResults(res.data.results);
      logAssistantEvent('search_run', null, { n: res.data.results.length });
    });
  };
  return (
    <Card title="Search by meaning" subtitle="Finds handovers about the same thing even when the words differ, e.g. “GPU” and “ground power”." icon={FileSearch}>
      <form onSubmit={submit} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <Input label="Describe what you are looking for" className="flex-1" value={q} onChange={(e) => setQ(e.target.value)} minLength={2} maxLength={200} />
        <Button type="submit" variant="primary" icon={SearchIcon} loading={busy}>Find</Button>
      </form>
      {results && (
        results.length === 0 ? <p className="mt-4 text-ink-700">No handover is close enough to that description.</p> : (
          <ul className="mt-4 divide-y divide-ink-200">
            {results.map((r) => (
              <li key={r.record_id}>
                <button type="button" onClick={() => onOpen(r.record_id)} className="flex min-h-11 w-full flex-col gap-0.5 py-3 text-left hover:bg-ink-50">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-fg">{r.department_name} · {shiftLabel(r)}</span>
                    <span className="text-meta text-ink-600">{formatEAT(r.shift_start, 'date')}</span>
                    <Badge tone="gray">match {Math.round(r.score * 100)}%</Badge>
                  </span>
                  <span className="text-ink-700">{r.snippet.kind}: {r.snippet.text}</span>
                </button>
              </li>
            ))}
          </ul>
        )
      )}
    </Card>
  );
}

// Plain-language summary of the last shift.
export function DigestCard() {
  const { data, loading } = useAssistantData('/assistant/digest', []);
  useEffect(() => { if (data) logAssistantEvent('digest_opened', null, { shift: data.shift_id }); }, [data]);
  if (loading) return <SkeletonCard lines={3} />;
  if (!data) return null;
  return (
    <Card title={data.title} subtitle={data.headline} icon={Gauge}>
      <ul className="list-disc space-y-1 pl-5 text-ink-800">
        {data.lines.map((l) => <li key={l}>{l}</li>)}
      </ul>
    </Card>
  );
}
