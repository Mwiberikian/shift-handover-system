// FR-14: the overview shows the acknowledgement completion rate per
// department and overall, and a toggle between the current/preceding-shift
// window and all records.
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import { Overview } from '../pages/SupervisorPage';
import { renderWithProviders } from './helpers';

const dept = (over) => ({
  department_id: over.code, code: over.code, name: over.name, open: 0, draft: 0, submitted: 0, queried: 0, acknowledged: 0,
  under_review: 0, escalated: 0, closed: 0, acknowledgement_due: 0, acknowledgement_done: 0, acknowledgement_rate: null,
  unacknowledged_overdue: 0, window_shifts: [], ...over,
});

const DATA = {
  generated_at: new Date().toISOString(),
  scope: 'current',
  threshold_hours: 2,
  unacknowledged_alerts: [],
  older_outstanding: 0,
  failed_emails: [],
  departments: [
    dept({ code: 'ground_ops', name: 'Ground Operations', submitted: 1, acknowledged: 3, acknowledgement_due: 4, acknowledgement_done: 3 }),
    dept({ code: 'maint', name: 'Aircraft Maintenance' }),
  ],
};

describe('supervisor overview (FR-14)', () => {
  test('shows each department’s acknowledgement rate and the overall rate', () => {
    renderWithProviders(<Overview data={DATA} onOpen={() => {}} scope="current" onScope={() => {}} />);
    const table = screen.getByRole('table', { name: /handover counts by department/i });
    const ground = within(table).getByText('Ground Operations').closest('tr');
    expect(within(ground).getByText('75%')).toBeInTheDocument();
    const maint = within(table).getByText('Aircraft Maintenance').closest('tr');
    expect(within(maint).getByText('—')).toBeInTheDocument();
    expect(screen.getByText('Acknowledgement rate').closest('div').parentElement).toHaveTextContent('75%');
    expect(screen.getByText('3 of 4 submitted')).toBeInTheDocument();
  });

  test('the toggle switches between the shift window and all records', async () => {
    const onScope = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<Overview data={DATA} onOpen={() => {}} scope="current" onScope={onScope} />);
    expect(screen.getByRole('radio', { name: 'Current and preceding shift' })).toBeChecked();
    await user.click(screen.getByRole('radio', { name: 'All records' }));
    expect(onScope).toHaveBeenCalledWith('all');
  });

  test('older unacknowledged records outside the window are flagged with a way to see them', async () => {
    const onScope = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<Overview data={{ ...DATA, older_outstanding: 2 }} onOpen={() => {}} scope="current" onScope={onScope} />);
    expect(screen.getByText('2 older handovers are still unacknowledged')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show all records' }));
    expect(onScope).toHaveBeenCalledWith('all');
  });
});

describe('failed emails (IR-07)', () => {
  test('lists each undelivered email alert with who, what and when, and opens the record', async () => {
    const onOpen = vi.fn();
    const user = userEvent.setup();
    const failed = [{
      notification_id: 'n1', type: 'handover_submitted', record_id: 'rec-1', failed_at: '2026-10-13T15:07:00Z',
      attempts: 4, last_error: 'connect ECONNREFUSED 127.0.0.1:1025', recipient_name: 'Brian Kamau', department_id: 'ground_ops',
    }];
    renderWithProviders(<Overview data={{ ...DATA, failed_emails: failed }} onOpen={onOpen} scope="current" onScope={() => {}} />);
    expect(screen.getByText('1 email alert could not be delivered')).toBeInTheDocument();
    expect(screen.getByText('Brian Kamau')).toBeInTheDocument();
    expect(screen.getByText(/Handover submitted · failed 2026-10-13 18:07 EAT after 4 attempts/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Open record' }));
    expect(onOpen).toHaveBeenCalledWith('rec-1');
  });

  test('nothing is shown when every email was delivered', () => {
    renderWithProviders(<Overview data={DATA} onOpen={() => {}} scope="current" onScope={() => {}} />);
    expect(screen.queryByText(/could not be delivered/)).not.toBeInTheDocument();
  });
});
