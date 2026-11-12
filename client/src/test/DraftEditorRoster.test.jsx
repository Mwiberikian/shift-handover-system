// Phase 3: the outgoing form uses the server's suggested receiver and offers
// only the next shift's roster while roster duty is on. Flag off, meta has
// neither field and the form is exactly as before.
import { render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { DraftEditor } from '../pages/OutgoingPage';

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } };
});

const TEMPLATE = {
  version: 1,
  field_definition: {
    fields: [
      { key: 'summary_notes', label: 'Shift summary', type: 'text', required: true, minLength: 20 },
      { key: 'tasks', label: 'Outstanding tasks', type: 'list', required: true, minItems: 1 },
    ],
  },
};
const draft = (overrides = {}) => ({
  record_id: 'rec-1', department_code: 'ground_ops', summary_notes: '', incoming_user_id: null, tasks: [], incidents: [], ...overrides,
});
const ROSTER = [{ user_id: 'r-1', staff_number: 'KQ2001', full_name: 'Rita Rostered' }];
const receiver = () => screen.getByLabelText(/incoming staff member/i);
const optionLabels = () => [...receiver().querySelectorAll('option')]
  .map((o) => o.textContent).filter((t) => !/Select who/.test(t));

describe('outgoing form receiver with roster duty', () => {
  test('flag on: the sole rostered person is preselected, only the roster is offered, and it says so', () => {
    const meta = {
      template: TEMPLATE, incoming_staff: ROSTER, roster_based_incoming: true, suggested_incoming_user_id: 'r-1',
    };
    render(<DraftEditor record={draft()} meta={meta} reload={vi.fn()} />);
    expect(receiver()).toHaveValue('r-1');
    expect(optionLabels()).toEqual(['Rita Rostered (KQ2001)']);
    expect(screen.getByText(/From the next shift’s roster/)).toBeInTheDocument();
  });

  test('flag on: a receiver already saved on the draft wins over the suggestion', () => {
    const meta = {
      template: TEMPLATE,
      incoming_staff: [...ROSTER, { user_id: 'r-2', staff_number: 'KQ2002', full_name: 'Sam Second' }],
      roster_based_incoming: true,
      suggested_incoming_user_id: 'r-1',
    };
    render(<DraftEditor record={draft({ incoming_user_id: 'r-2' })} meta={meta} reload={vi.fn()} />);
    expect(receiver()).toHaveValue('r-2');
  });

  test('flag off: nothing is preselected and the hint is unchanged', () => {
    const meta = { template: TEMPLATE, incoming_staff: [{ user_id: 'inc-1', staff_number: 'KQ1002', full_name: 'Ivy Incoming' }] };
    render(<DraftEditor record={draft()} meta={meta} reload={vi.fn()} />);
    expect(receiver()).toHaveValue('');
    expect(screen.getByText('They will be notified when you submit.')).toBeInTheDocument();
    expect(screen.queryByText(/next shift’s roster/)).not.toBeInTheDocument();
  });
});
