// Part L4: the Reports page (lists, New report, department filters and
// downloads), the report editor and read view, and the Share dialog.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import api, { tokenStore } from '../api';
import ReportsPage, { exportParams, filterParams } from '../pages/ReportsPage';
import ReportPage from '../pages/ReportPage';
import { NAV } from '../components/shell/nav';
import { fakeToken, renderWithProviders } from './helpers';

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual, default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
  };
});

const ROW = {
  report_id: 'rrrrrrrr-0000-4000-8000-000000000001', title: 'Night shift report 2026-10-14', status: 'submitted',
  shift_type: 'night', shift_start: '2026-10-14T15:00:00Z', shift_end: '2026-10-15T03:00:00Z', department_name: 'Ground Operations',
  author_id: 'user-outgoing_staff', author_name: 'Amina Otieno', author_staff_number: 'KQ1001', submitted_at: '2026-10-15T02:30:00Z',
  share_count: 0, my_read_at: null,
};
const DETAIL = {
  ...ROW, done_text: 'Checked GPU on stand 5 and cleared the backlog.', pending_text: 'Fuel truck 3 waiting for a part.',
  nothing_pending: false, tasks: [], session_duration_ms: 3 * 3600 * 1000, shares: [], access: 'author',
};

function Where() {
  const loc = useLocation();
  return <div data-testid="where">{loc.pathname}{loc.search}</div>;
}
const renderAt = (ui, route, path) => renderWithProviders(
  <Routes>
    <Route path={path} element={<>{ui}<Where /></>} />
    <Route path="*" element={<Where />} />
  </Routes>,
  { route },
);

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:x');
  globalThis.URL.revokeObjectURL = vi.fn();
});

describe('navigation', () => {
  test('every role has Reports in the sidebar', () => {
    for (const role of Object.keys(NAV)) expect(NAV[role].some((i) => i.to === '/reports')).toBe(true);
  });
});

describe('Reports page - staff', () => {
  test('lists my reports and switches to Shared with me', async () => {
    tokenStore.set(fakeToken('outgoing_staff'));
    api.get.mockResolvedValue({ data: { items: [ROW], total: 1 } });
    const user = userEvent.setup();
    renderAt(<ReportsPage />, '/reports', '/reports');

    expect(await screen.findByText(ROW.title)).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/reports', { params: { scope: 'mine', page_size: 100 } });
    expect(screen.queryByRole('button', { name: 'Download CSV' })).not.toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Department' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'Shared with me' }));
    await waitFor(() => expect(api.get).toHaveBeenLastCalledWith('/reports', { params: { scope: 'shared', page_size: 100 } }));
    expect(screen.getByTestId('where')).toHaveTextContent('/reports?view=shared');
  });

  test('New report creates a prefilled draft and opens it', async () => {
    tokenStore.set(fakeToken('incoming_staff'));
    api.get.mockResolvedValue({ data: { items: [], total: 0 } });
    api.post.mockResolvedValue({ data: { ...DETAIL, status: 'draft', report_id: 'new-id' } });
    const user = userEvent.setup();
    renderAt(<ReportsPage />, '/reports', '/reports');

    expect(await screen.findByText('You have not written a report yet.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'New report' }));
    expect(api.post).toHaveBeenCalledWith('/reports');
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/reports/new-id'));
  });
});

describe('Reports page - supervisors and admin', () => {
  test('EAT day bounds; the CSV export uses the same filters', () => {
    const f = {
      from: '2026-10-01', to: '2026-10-14', author_id: 'u1', department_id: 'd1',
    };
    expect(filterParams(f)).toEqual({
      from: '2026-10-01T00:00:00+03:00', to: '2026-10-14T23:59:59.999+03:00', author_id: 'u1', department_id: 'd1',
    });
    expect(exportParams(f)).toEqual({
      from: '2026-10-01T00:00:00+03:00', to: '2026-10-14T23:59:59.999+03:00', author: 'u1', department: 'd1',
    });
    expect(exportParams({ from: '', to: '', author_id: '', department_id: '' })).toEqual({});
  });

  test('the department table filters, and downloads a PDF per report and a CSV', async () => {
    tokenStore.set(fakeToken('supervisor'));
    api.get.mockImplementation((url) => {
      if (url === '/reports') return Promise.resolve({ data: { items: [ROW], total: 1 } });
      if (url === '/directory') return Promise.resolve({ data: [{ user_id: 'u1', full_name: 'Amina Otieno', role: 'outgoing_staff', department_name: 'Ground Operations' }] });
      return Promise.resolve({ data: new Blob(['x']), headers: { 'content-disposition': 'attachment; filename="f"' } });
    });
    const user = userEvent.setup();
    renderAt(<ReportsPage />, '/reports', '/reports');

    expect(await screen.findByText(ROW.title)).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/reports', { params: { scope: 'department', page_size: 100 } });
    expect(screen.queryByRole('button', { name: 'New report' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Department')).not.toBeInTheDocument(); // admin only

    await user.type(screen.getByLabelText('From (EAT)'), '2026-10-01');
    await user.selectOptions(await screen.findByLabelText('Author'), 'u1');
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(api.get).toHaveBeenLastCalledWith('/reports', {
      params: {
        scope: 'department', page_size: 100, from: '2026-10-01T00:00:00+03:00', author_id: 'u1',
      },
    }));

    await user.click(screen.getByRole('button', { name: `Download "${ROW.title}" as PDF` }));
    expect(api.get).toHaveBeenCalledWith(`/reports/${ROW.report_id}/download`, { params: { format: 'pdf' }, responseType: 'blob' });
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/reports$/); // the button does not open the row

    await user.click(screen.getByRole('button', { name: 'Download CSV' }));
    expect(api.get).toHaveBeenCalledWith('/reports/export', {
      params: { format: 'csv', from: '2026-10-01T00:00:00+03:00', author: 'u1' }, responseType: 'blob',
    });
  });

  test('admins also get a department filter', async () => {
    tokenStore.set(fakeToken('admin', { department_id: null }));
    api.get.mockImplementation((url) => Promise.resolve({
      data: url === '/directory/departments' ? [{ department_id: 'd1', name: 'Ground Operations' }] : url === '/reports' ? { items: [], total: 0 } : [],
    }));
    renderAt(<ReportsPage />, '/reports', '/reports');
    const select = await screen.findByLabelText('Department');
    expect(await within(select).findByRole('option', { name: 'Ground Operations' })).toBeInTheDocument();
  });
});

describe('report editor (author, draft)', () => {
  const DRAFT = {
    ...DETAIL, status: 'draft', submitted_at: null, done_text: '- Replace tyre on tug 12', pending_text: '', nothing_pending: true,
    tasks: [{ task_id: 't1', description: 'Replace tyre on tug 12', status: 'resolved', priority: 'medium' }],
  };

  test('shows the prefilled text, counts characters, and "nothing pending" disables the pending box', async () => {
    tokenStore.set(fakeToken('outgoing_staff'));
    api.get.mockResolvedValue({ data: DRAFT });
    const user = userEvent.setup();
    renderAt(<ReportPage />, `/reports/${DRAFT.report_id}`, '/reports/:id');

    const done = await screen.findByLabelText(/What was done/);
    expect(done).toHaveValue('- Replace tyre on tug 12');
    expect(done).toHaveAttribute('maxLength', '5000');
    expect(screen.getByText('24 / 5000 characters (at least 10)')).toBeInTheDocument();
    expect(screen.getByText('Replace tyre on tug 12')).toBeInTheDocument();
    const pending = screen.getByLabelText(/What is pending/);
    expect(pending).toBeDisabled();
    await user.click(screen.getByLabelText(/Nothing pending/));
    expect(pending).toBeEnabled();
  });

  test('submit saves, then lists what is missing on a 422', async () => {
    tokenStore.set(fakeToken('outgoing_staff'));
    api.get.mockResolvedValue({ data: { ...DRAFT, done_text: 'short' } });
    api.patch.mockResolvedValue({ data: { ...DRAFT, done_text: 'short' } });
    api.post.mockRejectedValue({
      response: {
        status: 422,
        data: { error: 'Report not submitted', details: { missing_fields: [{ field: 'done_text', label: 'What was done', reason: 'must be 10 to 5000 characters' }] } },
      },
    });
    const user = userEvent.setup();
    renderAt(<ReportPage />, `/reports/${DRAFT.report_id}`, '/reports/:id');

    await user.click(await screen.findByRole('button', { name: 'Submit report' }));
    expect(api.patch).toHaveBeenCalledWith(`/reports/${DRAFT.report_id}`, {
      title: DRAFT.title, done_text: 'short', pending_text: '', nothing_pending: true,
    });
    expect(api.post).toHaveBeenCalledWith(`/reports/${DRAFT.report_id}/submit`);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('This report cannot be submitted yet');
    expect(alert).toHaveTextContent('What was done: must be 10 to 5000 characters');
  });
});

describe('read view and sharing', () => {
  const CANDIDATES = [
    { user_id: 'user-outgoing_staff', full_name: 'Amina Otieno', role: 'outgoing_staff', department_name: 'Ground Operations' },
    { user_id: 'c1', full_name: 'Brian Kamau', role: 'incoming_staff', department_name: 'Ground Operations' },
    { user_id: 'c2', full_name: 'Grace Wanjiru', role: 'supervisor', department_name: 'Cargo' },
    { user_id: 'c3', full_name: 'Peter Njoroge', role: 'supervisor', department_name: 'Ground Operations' },
  ];

  test('a submitted report is read-only with Share, Download PDF and a print view', async () => {
    tokenStore.set(fakeToken('outgoing_staff'));
    api.get.mockResolvedValue({ data: DETAIL });
    renderAt(<ReportPage />, `/reports/${DETAIL.report_id}`, '/reports/:id');

    expect(await screen.findByText(DETAIL.done_text)).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByText(/session time 3 h/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Print view' })).toHaveAttribute('href', `/reports/${DETAIL.report_id}/print`);
    expect(screen.getByRole('button', { name: 'Share' })).toBeInTheDocument();
    expect(screen.getByText('Not shared with anyone.')).toBeInTheDocument();
  });

  test('a recipient cannot share it on and does not see the share list', async () => {
    tokenStore.set(fakeToken('incoming_staff'));
    api.get.mockResolvedValue({ data: { ...DETAIL, access: 'recipient' } });
    renderAt(<ReportPage />, `/reports/${DETAIL.report_id}`, '/reports/:id');
    expect(await screen.findByText(DETAIL.done_text)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Share' })).not.toBeInTheDocument();
    expect(screen.queryByText('Shared with')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download PDF' })).toBeInTheDocument();
  });

  test('the Share dialog offers only the allowed people (not the author), keeps earlier shares fixed, and sends the email choice', async () => {
    tokenStore.set(fakeToken('outgoing_staff'));
    const shared = { ...DETAIL, shares: [{ user_id: 'c3', full_name: 'Peter Njoroge', shared_at: ROW.submitted_at, shared_by_name: 'Amina Otieno', read_at: null }] };
    api.get.mockImplementation((url) => Promise.resolve({ data: url === '/reports/share-candidates' ? CANDIDATES : shared }));
    api.post.mockResolvedValue({ data: { shared: ['c1'], already_shared: [] } });
    const user = userEvent.setup();
    renderAt(<ReportPage />, `/reports/${DETAIL.report_id}`, '/reports/:id');

    await user.click(await screen.findByRole('button', { name: 'Share' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('You can share with colleagues in your department and with supervisors.')).toBeInTheDocument();
    await within(dialog).findByLabelText(/Brian Kamau/);
    expect(within(dialog).queryByLabelText(/Amina Otieno/)).not.toBeInTheDocument();
    const peter = within(dialog).getByLabelText(/Peter Njoroge/);
    expect(peter).toBeChecked();
    expect(peter).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: /^Share/ })).toBeDisabled();

    await user.type(within(dialog).getByLabelText('Find a person'), 'cargo');
    expect(within(dialog).queryByLabelText(/Brian Kamau/)).not.toBeInTheDocument();
    await user.clear(within(dialog).getByLabelText('Find a person'));
    await user.click(within(dialog).getByLabelText(/Brian Kamau/));
    await user.click(within(dialog).getByLabelText(/Also send an email alert/));
    expect(within(dialog).getByText('The email has the report title and a link only, never the report text.')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Share with 1' }));
    expect(api.post).toHaveBeenCalledWith(`/reports/${DETAIL.report_id}/share`, { user_ids: ['c1'], email: true });
  });
});
