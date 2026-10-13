import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Download, Printer } from 'lucide-react';
import api, { errorMessage } from '../api';
import { Button, Callout } from '../components/ui';
import { fmt, shiftLabel } from '../lib/format';

// Print-friendly view of one record (FR-20), built from
// GET /api/handovers/:id/export so the page and the download hold the same data.
// Opens in the same tab: the session token lives in sessionStorage, which a
// new tab does not share.

const ACTION_LABEL = {
  create: 'Created', update: 'Updated', submit: 'Submitted', carry_forward: 'Carried forward',
  acknowledge: 'Acknowledged', query: 'Query raised', clarify: 'Clarified', open_review: 'Review opened',
  review: 'Reviewed', resolve: 'Escalation resolved',
};

function Section({ title, children }) {
  return (
    <section className="mt-6 break-inside-avoid-page">
      <h2 className="mb-2 border-b border-ink-300 pb-1 text-base font-semibold text-fg print:border-black print:text-black">{title}</h2>
      {children}
    </section>
  );
}

function Rows({ head, rows, empty }) {
  if (!rows.length) return <p className="text-ink-700 print:text-black">{empty}</p>;
  return (
    <table className="w-full border-collapse text-left text-sm">
      <thead>
        <tr>{head.map((h) => <th key={h} className="border-b border-ink-300 py-1 pr-3 font-semibold print:border-black">{h}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          // eslint-disable-next-line react/no-array-index-key
          <tr key={i} className="break-inside-avoid align-top">
            {r.map((c, j) => <td key={j} className="border-b border-ink-200 py-1 pr-3 print:border-gray-400">{c}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function PrintRecord() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get(`/handovers/${id}/export`).then((r) => setData(r.data)).catch((err) => setError(errorMessage(err)));
  }, [id]);

  const download = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `handover-${id}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const r = data?.record;
  return (
    <div className="min-h-dvh bg-surface text-fg print:bg-white print:text-black">
      <div className="mx-auto max-w-4xl px-4 py-6 print:max-w-none print:p-0">
        <div className="mb-6 flex flex-wrap items-center gap-2 print:hidden">
          <Button icon={ArrowLeft} onClick={() => navigate(-1)}>Back</Button>
          <span className="flex-1" />
          <Button icon={Download} onClick={download} disabled={!data}>Download JSON</Button>
          <Button variant="primary" icon={Printer} onClick={() => window.print()} disabled={!data}>Print</Button>
        </div>

        {error && <Callout tone="danger" title="Could not load this record">{error}</Callout>}
        {!r && !error && <p className="text-ink-700">Loading…</p>}

        {r && (
          <article>
            <header>
              <p className="text-sm font-semibold tracking-wide text-ink-700 uppercase print:text-black">Shift handover record · {r.department_name}</p>
              <h1 className="text-2xl font-semibold">{shiftLabel(r)} · {fmt(r.shift_start)}</h1>
              <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
                {[
                  ['Record', r.record_id], ['Status', r.status.replace('_', ' ')], ['Template', r.template ? `v${r.template.version}` : '—'],
                  ['Outgoing', r.outgoing_name ?? '—'], ['Incoming', r.incoming_name ?? '—'], ['Submitted', fmt(r.submitted_at)],
                  ['Shift ends', fmt(r.shift_end)], ['Closed', fmt(r.closed_at)], ['Exported', fmt(data.exported_at)],
                ].map(([k, v]) => (
                  <div key={k} className="min-w-0"><dt className="inline font-semibold">{k}: </dt><dd className="inline break-all">{v}</dd></div>
                ))}
              </dl>
            </header>

            <Section title="Summary">
              <p className="whitespace-pre-wrap">{r.summary_notes || 'No summary.'}</p>
            </Section>

            <Section title={`Tasks (${r.tasks.length})`}>
              <Rows
                head={['Task', 'Priority', 'Status', 'Carried forward']}
                rows={r.tasks.map((t) => [t.description, t.priority, t.status.replace('_', ' '), t.carried_from_task_id ? 'Yes' : 'No'])}
                empty="No tasks."
              />
            </Section>

            <Section title={`Incidents (${r.incidents.length})`}>
              <Rows
                head={['Incident', 'Severity', 'Occurred', 'Reported by']}
                rows={r.incidents.map((i) => [<>{i.title}{i.description && <div className="text-ink-700 print:text-black">{i.description}</div>}</>, i.severity, fmt(i.occurred_at), i.reported_by_name ?? '—'])}
                empty="No incidents."
              />
            </Section>

            <Section title="Acknowledgement">
              {r.acknowledgement ? (
                <p>
                  {r.acknowledgement.confirmed_at ? `Confirmed ${fmt(r.acknowledgement.confirmed_at)}` : 'Not confirmed'}
                  {r.acknowledgement.query_raised && ' · a query was raised'}
                  {r.acknowledgement.comments && <><br />Comments: {r.acknowledgement.comments}</>}
                </p>
              ) : <p>Not acknowledged.</p>}
            </Section>

            <Section title={`Supervisor reviews (${r.reviews.length})`}>
              <Rows
                head={['Decision', 'Supervisor', 'When', 'Comments']}
                rows={r.reviews.map((v) => [v.decision, v.supervisor_name, fmt(v.reviewed_at), v.comments ?? ''])}
                empty="No reviews."
              />
            </Section>

            <Section title={`Audit trail (${data.audit_log.length})`}>
              <Rows
                head={['When', 'Who', 'What', 'Entity']}
                rows={data.audit_log.map((a) => [fmt(a.logged_at), a.user_name ?? '—', ACTION_LABEL[a.action] ?? a.action, `${a.entity_type.replace('_', ' ')} ${a.entity_id.slice(0, 8)}`])}
                empty="No audit entries."
              />
            </Section>
          </article>
        )}
      </div>
    </div>
  );
}
