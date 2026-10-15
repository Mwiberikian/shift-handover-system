import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  ArrowLeft, Download, Printer, Save, Send, Share2,
} from 'lucide-react';
import api, { errorMessage } from '../api';
import {
  Badge, Button, ButtonLink, Callout, Card, Checkbox, Input, PageHeader, SkeletonCard, StatusBadge, Textarea,
} from '../components/ui';
import ShareDialog from '../components/reports/ShareDialog';
import { downloadReportPdf } from '../lib/download';
import { fmtDuration, formatEAT, shiftLabel } from '../lib/format';
import { REPORT_TEXT, REPORT_TITLE_MAX } from '../lib/limits';
import { toast } from '../lib/toast';
import useAction from '../lib/useAction';

// One shift report. The author edits a draft here and submits it; once
// submitted it is read-only for everyone, and can be shared, printed and
// downloaded as a PDF.

function TaskList({ tasks }) {
  if (!tasks.length) return <p className="text-ink-600">No linked tasks.</p>;
  return (
    <ul className="divide-y divide-ink-100">
      {tasks.map((t) => (
        <li key={t.task_id} className="flex flex-wrap items-center gap-2 py-2">
          <span className="min-w-0 flex-1">{t.description}</span>
          <StatusBadge kind="task" value={t.status} />
          <StatusBadge kind="priority" value={t.priority} />
        </li>
      ))}
    </ul>
  );
}

const counter = (text) => `${text.trim().length} / ${REPORT_TEXT.max} characters (at least ${REPORT_TEXT.min})`;

function Editor({ report, onSaved }) {
  const [form, setForm] = useState({
    title: report.title, done_text: report.done_text, pending_text: report.pending_text, nothing_pending: report.nothing_pending,
  });
  const [missing, setMissing] = useState(null);
  const [save, saving] = useAction();
  const [submit, submitting] = useAction();
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  const persist = async () => (await api.patch(`/reports/${report.report_id}`, form)).data;

  const doSubmit = () => submit(async () => {
    setMissing(null);
    await persist();
    try {
      onSaved((await api.post(`/reports/${report.report_id}/submit`)).data);
      toast.success('Report submitted');
    } catch (err) {
      if (err.response?.status === 422) {
        setMissing(err.response.data.details.missing_fields);
        return;
      }
      throw err;
    }
  });

  return (
    <form onSubmit={(e) => { e.preventDefault(); doSubmit(); }} className="space-y-4">
      {missing && (
        <Callout tone="danger" title="This report cannot be submitted yet">
          <ul className="list-disc pl-5">{missing.map((m) => <li key={m.field}>{m.label}: {m.reason}</li>)}</ul>
        </Callout>
      )}
      <Card>
        <div className="space-y-4">
          <Input label="Title" required value={form.title} onChange={set('title')} maxLength={REPORT_TITLE_MAX} />
          <Textarea
            label="What was done"
            required
            rows={8}
            value={form.done_text}
            onChange={set('done_text')}
            maxLength={REPORT_TEXT.max}
            hint={counter(form.done_text)}
            error={missing?.some((m) => m.field === 'done_text')}
          />
          <Checkbox
            label="Nothing pending"
            description="Tick if nothing is left for the next shift."
            checked={form.nothing_pending}
            onChange={set('nothing_pending')}
          />
          <Textarea
            label="What is pending"
            rows={6}
            value={form.pending_text}
            onChange={set('pending_text')}
            maxLength={REPORT_TEXT.max}
            disabled={form.nothing_pending}
            hint={form.nothing_pending ? 'Not needed: "Nothing pending" is ticked.' : counter(form.pending_text)}
            error={missing?.some((m) => m.field === 'pending_text')}
          />
        </div>
      </Card>
      <Card title="Linked tasks" subtitle="Filled in from your work session when the report was created.">
        <TaskList tasks={report.tasks} />
      </Card>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button icon={Save} loading={saving} onClick={() => save(async () => onSaved(await persist()), 'Draft saved')}>Save draft</Button>
        <Button type="submit" variant="primary" icon={Send} loading={submitting}>Submit report</Button>
      </div>
      <p className="text-meta text-ink-600">Once submitted, a report cannot be changed.</p>
    </form>
  );
}

function ReadView({ report, onShared }) {
  const [sharing, setSharing] = useState(false);
  const [download, downloading] = useAction();
  const canShare = report.status === 'submitted' && ['author', 'supervisor', 'admin'].includes(report.access);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {canShare && <Button variant="primary" icon={Share2} onClick={() => setSharing(true)}>Share</Button>}
        <Button icon={Download} loading={downloading} onClick={() => download(() => downloadReportPdf(report.report_id), 'PDF downloaded')}>Download PDF</Button>
        <ButtonLink to={`/reports/${report.report_id}/print`} icon={Printer}>Print view</ButtonLink>
      </div>
      <Card title="What was done">
        <p className="whitespace-pre-wrap">{report.done_text}</p>
      </Card>
      <Card title="What is pending">
        <p className="whitespace-pre-wrap">{report.nothing_pending ? 'Nothing pending.' : report.pending_text}</p>
      </Card>
      <Card title="Linked tasks"><TaskList tasks={report.tasks} /></Card>
      {report.access !== 'recipient' && (
        <Card title="Shared with">
          {report.shares.length ? (
            <ul className="divide-y divide-ink-100">
              {report.shares.map((s) => (
                <li key={s.user_id} className="flex flex-wrap items-center gap-2 py-2">
                  <span className="min-w-0 flex-1">{s.full_name}</span>
                  <span className="text-meta text-ink-600">shared {formatEAT(s.shared_at)} by {s.shared_by_name}</span>
                  {s.read_at ? <Badge tone="green">Read {formatEAT(s.read_at)}</Badge> : <Badge>Unread</Badge>}
                </li>
              ))}
            </ul>
          ) : <p className="text-ink-600">Not shared with anyone.</p>}
        </Card>
      )}
      {canShare && <ShareDialog report={report} open={sharing} onClose={() => setSharing(false)} onShared={onShared} />}
    </div>
  );
}

export default function ReportPage() {
  const { id } = useParams();
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api.get(`/reports/${id}`).then((r) => setReport(r.data)).catch((err) => setError(errorMessage(err)));
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const editing = report?.access === 'author' && report.status === 'draft';

  return (
    <>
      <ButtonLink to="/reports" variant="ghost" icon={ArrowLeft} className="-ml-3 mb-2">All reports</ButtonLink>
      {error && <Callout tone="danger" title="Could not open this report">{error}</Callout>}
      {!report && !error && <SkeletonCard />}
      {report && (
        <>
          <PageHeader
            title={editing ? 'Shift report (draft)' : report.title}
            subtitle={`${report.author_name} (${report.author_staff_number}) · ${report.department_name} · ${shiftLabel(report)}, ${formatEAT(report.shift_start)} to ${formatEAT(report.shift_end)} · session time ${fmtDuration(report.session_duration_ms)}`}
            actions={<StatusBadge kind="report" value={report.status} />}
          />
          {report.submitted_at && <p className="-mt-4 mb-4 text-meta text-ink-600">Submitted {formatEAT(report.submitted_at)}</p>}
          {editing
            ? <Editor report={report} onSaved={(r) => setReport({ ...report, ...r })} />
            : <ReadView report={report} onShared={load} />}
        </>
      )}
    </>
  );
}
