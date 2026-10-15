import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Download, Printer } from 'lucide-react';
import api, { errorMessage } from '../api';
import { Button, Callout } from '../components/ui';
import { downloadReportPdf } from '../lib/download';
import { fmtDuration, formatEAT, shiftLabel } from '../lib/format';
import useAction from '../lib/useAction';

// Print-friendly view of one shift report, outside the app layout (like
// PrintRecord), with Print and Download PDF.
export default function PrintReport() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [r, setReport] = useState(null);
  const [error, setError] = useState('');
  const [download, downloading] = useAction();

  useEffect(() => {
    api.get(`/reports/${id}`).then((res) => setReport(res.data)).catch((err) => setError(errorMessage(err)));
  }, [id]);

  return (
    <div className="min-h-dvh bg-surface text-fg print:bg-white print:text-black">
      <div className="mx-auto max-w-3xl px-4 py-6 print:max-w-none print:p-0">
        <div className="mb-6 flex flex-wrap items-center gap-2 print:hidden">
          <Button icon={ArrowLeft} onClick={() => navigate(-1)}>Back</Button>
          <span className="flex-1" />
          <Button icon={Download} loading={downloading} disabled={!r} onClick={() => download(() => downloadReportPdf(id), 'PDF downloaded')}>Download PDF</Button>
          <Button variant="primary" icon={Printer} disabled={!r} onClick={() => window.print()}>Print</Button>
        </div>

        {error && <Callout tone="danger" title="Could not load this report">{error}</Callout>}
        {!r && !error && <p className="text-ink-700">Loading…</p>}

        {r && (
          <article>
            <p className="text-sm font-semibold tracking-wide text-ink-700 uppercase print:text-black">Shift report · {r.department_name}</p>
            <h1 className="text-2xl font-semibold">{r.title}</h1>
            {r.status !== 'submitted' && <p className="font-semibold text-status-red">Draft - not submitted</p>}
            <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
              {[
                ['Author', `${r.author_name} (${r.author_staff_number})`],
                ['Shift', `${shiftLabel(r)}, ${formatEAT(r.shift_start)} to ${formatEAT(r.shift_end)}`],
                ['Submitted', r.submitted_at ? formatEAT(r.submitted_at) : 'Not yet'],
                ['Session time', fmtDuration(r.session_duration_ms)],
              ].map(([k, v]) => <div key={k}><dt className="inline font-semibold">{k}: </dt><dd className="inline">{v}</dd></div>)}
            </dl>
            <h2 className="mt-6 border-b border-ink-300 pb-1 text-base font-semibold print:border-black">What was done</h2>
            <p className="mt-2 whitespace-pre-wrap">{r.done_text}</p>
            <h2 className="mt-6 border-b border-ink-300 pb-1 text-base font-semibold print:border-black">What is pending</h2>
            <p className="mt-2 whitespace-pre-wrap">{r.nothing_pending ? 'Nothing pending.' : r.pending_text}</p>
            <h2 className="mt-6 border-b border-ink-300 pb-1 text-base font-semibold print:border-black">Linked tasks ({r.tasks.length})</h2>
            {r.tasks.length ? (
              <ul className="mt-2 list-disc pl-5">
                {r.tasks.map((t) => <li key={t.task_id}>{t.description} ({t.status.replace('_', ' ')}, {t.priority} priority)</li>)}
              </ul>
            ) : <p className="mt-2">None.</p>}
          </article>
        )}
      </div>
    </div>
  );
}
