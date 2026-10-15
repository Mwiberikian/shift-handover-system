import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Download, FilePlus2, FileText, Filter, Inbox,
} from 'lucide-react';
import api from '../api';
import { useAuth } from '../auth/AuthContext';
import {
  Button, Card, EmptyState, Input, PageHeader, SegmentedPicker, Select, StatusBadge, Table,
} from '../components/ui';
import { downloadReportPdf, downloadReportsCsv } from '../lib/download';
import { formatEAT, shiftLabel } from '../lib/format';
import { toastError } from '../lib/toast';
import useAction from '../lib/useAction';

// Shift reports (Part L4).
//  - Outgoing and incoming staff: New report (prefilled), My reports, Shared with me.
//  - Supervisors and admins: the department's submitted reports with filters,
//    Download PDF per report and Download CSV for the filtered set; plus their
//    own and shared reports.

const MANAGERS = ['supervisor', 'admin'];

const VIEWS = {
  department: { label: 'Department', empty: 'No submitted reports match these filters.' },
  mine: { label: 'My reports', empty: 'You have not written a report yet.' },
  shared: { label: 'Shared with me', empty: 'No one has shared a report with you yet.' },
};

// Dates are East Africa Time days (DR-02), whatever the browser's zone.
export function filterParams(f) {
  const p = {};
  if (f.from) p.from = `${f.from}T00:00:00+03:00`;
  if (f.to) p.to = `${f.to}T23:59:59.999+03:00`;
  if (f.author_id) p.author_id = f.author_id;
  if (f.department_id) p.department_id = f.department_id;
  return p;
}

// The same filters for the CSV export, which names them author and department.
export function exportParams(f) {
  const { author_id: author, department_id: department, ...p } = filterParams(f);
  return { ...p, ...(author && { author }), ...(department && { department }) };
}

function PdfButton({ report }) {
  const [run, busy] = useAction();
  return (
    <Button
      size="sm"
      icon={Download}
      loading={busy}
      onClick={(e) => { e.stopPropagation(); run(() => downloadReportPdf(report.report_id), 'PDF downloaded'); }}
      onKeyDown={(e) => e.stopPropagation()}
      aria-label={`Download "${report.title}" as PDF`}
    >
      PDF
    </Button>
  );
}

function DepartmentFilters({ role, value, onApply, busy }) {
  const [f, setF] = useState(value);
  const [people, setPeople] = useState([]);
  const [departments, setDepartments] = useState([]);
  useEffect(() => {
    api.get('/directory').then((r) => setPeople(r.data.filter((u) => u.role !== 'admin'))).catch(() => {});
    if (role === 'admin') api.get('/directory/departments').then((r) => setDepartments(r.data)).catch(() => {});
  }, [role]);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); onApply(f); }}
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[10rem_10rem_minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end"
    >
      <Input label="From (EAT)" type="date" value={f.from} onChange={set('from')} />
      <Input label="To (EAT)" type="date" value={f.to} onChange={set('to')} />
      <Select
        label="Author"
        value={f.author_id}
        onChange={set('author_id')}
        placeholder="Anyone"
        options={people.map((u) => ({ value: u.user_id, label: u.department_name ? `${u.full_name} (${u.department_name})` : u.full_name }))}
      />
      {role === 'admin' ? (
        <Select
          label="Department"
          value={f.department_id}
          onChange={set('department_id')}
          placeholder="All departments"
          options={departments.map((d) => ({ value: d.department_id, label: d.name }))}
        />
      ) : <div className="hidden lg:block" />}
      <Button type="submit" variant="primary" icon={Filter} loading={busy}>Apply</Button>
    </form>
  );
}

export default function ReportsPage() {
  const { claims } = useAuth();
  const navigate = useNavigate();
  const manager = MANAGERS.includes(claims.role);
  const [params, setParams] = useSearchParams();
  const views = manager ? ['department', 'mine', 'shared'] : ['mine', 'shared'];
  const view = views.includes(params.get('view')) ? params.get('view') : views[0];

  const [filters, setFilters] = useState({
    from: '', to: '', author_id: '', department_id: '',
  });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [create, creating] = useAction();
  const [exportCsv, exporting] = useAction();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const query = { scope: view, page_size: 100, ...(view === 'department' ? filterParams(filters) : {}) };
      setData((await api.get('/reports', { params: query })).data);
    } catch (err) {
      toastError(err);
      setData({ items: [], total: 0 });
    } finally {
      setLoading(false);
    }
  }, [view, filters]);
  useEffect(() => { load(); }, [load]);

  const newReport = () => create(async () => {
    const { data: report } = await api.post('/reports');
    navigate(`/reports/${report.report_id}`);
  });

  const columns = [
    {
      key: 'title',
      header: 'Report',
      render: (r) => (
        <div className="min-w-[12rem]">
          <div className="font-medium text-fg">{r.title}</div>
          <div className="text-meta text-ink-600">{shiftLabel(r)} · {formatEAT(r.shift_start, 'date')} · {r.department_name}</div>
        </div>
      ),
    },
    ...(view === 'mine' ? [] : [{ key: 'author_name', header: 'Author', render: (r) => `${r.author_name} (${r.author_staff_number})` }]),
    { key: 'status', header: 'Status', render: (r) => <StatusBadge kind="report" value={r.status} /> },
    {
      key: 'submitted_at',
      header: 'Submitted',
      hideBelow: 'md',
      render: (r) => (r.submitted_at ? formatEAT(r.submitted_at) : 'Not yet'),
    },
    ...(view === 'shared' ? [{
      key: 'my_read_at', header: 'Read', hideBelow: 'lg', render: (r) => (r.my_read_at ? formatEAT(r.my_read_at) : 'Unread'),
    }] : []),
    ...(view === 'mine' ? [{
      key: 'share_count', header: 'Shared with', hideBelow: 'lg', render: (r) => (r.share_count ? `${r.share_count} ${r.share_count === 1 ? 'person' : 'people'}` : '—'),
    }] : []),
    {
      key: 'actions',
      header: <span className="sr-only">Download</span>,
      className: 'text-right',
      render: (r) => (r.status === 'submitted' || view === 'mine' ? <PdfButton report={r} /> : null),
    },
  ];

  const headerActions = (
    <>
      {view === 'department' && (
        <Button icon={Download} loading={exporting} onClick={() => exportCsv(() => downloadReportsCsv(exportParams(filters)), 'CSV downloaded')}>
          Download CSV
        </Button>
      )}
      {!manager && <Button variant="primary" icon={FilePlus2} loading={creating} onClick={newReport}>New report</Button>}
    </>
  );

  return (
    <>
      <PageHeader
        title="Reports"
        subtitle={manager
          ? 'Submitted shift reports for your department, and reports shared with you. Times are Nairobi time (EAT).'
          : 'Your own account of each shift: what was done and what is still pending. Times are Nairobi time (EAT).'}
        actions={headerActions}
      />
      <SegmentedPicker
        label="Show"
        value={view}
        onChange={(v) => setParams(v === views[0] ? {} : { view: v }, { replace: true })}
        options={views.map((v) => ({ value: v, label: VIEWS[v].label }))}
        className="mb-4"
      />
      {view === 'department' && (
        <Card className="mb-4">
          <DepartmentFilters role={claims.role} value={filters} onApply={setFilters} busy={loading} />
        </Card>
      )}
      <Card flush title={data ? `${data.total} report${data.total === 1 ? '' : 's'}` : undefined}>
        <Table
          loading={data === null}
          columns={columns}
          rows={data?.items}
          rowKey={(r) => r.report_id}
          onRowClick={(r) => navigate(`/reports/${r.report_id}`)}
          rowLabel={(r) => `Open ${r.title}`}
          caption={VIEWS[view].label}
          empty={<EmptyState icon={view === 'shared' ? Inbox : FileText} title="No reports" message={VIEWS[view].empty} />}
        />
      </Card>
    </>
  );
}
