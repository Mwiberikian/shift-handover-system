import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import api from '../api';
import { DraftEditor } from '../pages/OutgoingPage';

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } };
});

// Same shape as the server test template: summary (20+ chars) and at least
// one task are required, incidents optional; an incoming user is always required.
const META = {
  template: {
    version: 1,
    field_definition: {
      fields: [
        { key: 'summary_notes', label: 'Shift summary', type: 'text', required: true, minLength: 20 },
        { key: 'tasks', label: 'Outstanding tasks', type: 'list', required: true, minItems: 1 },
        { key: 'incidents', label: 'Incidents', type: 'list', required: false },
      ],
    },
  },
  incoming_staff: [{ user_id: 'inc-1', staff_number: 'KQ1002', full_name: 'Ivy Incoming' }],
};

const draft = (overrides = {}) => ({
  record_id: 'rec-1', department_code: 'ground_ops', summary_notes: '', incoming_user_id: null, tasks: [], incidents: [], ...overrides,
});
const TASK = { task_id: 't1', description: 'Check GPU on stand 5', priority: 'high', status: 'open' };

const submitButtons = () => screen.getAllByRole('button', { name: /submit handover/i });
const reload = vi.fn();

beforeEach(() => {
  api.patch.mockResolvedValue({ data: {} });
  api.post.mockResolvedValue({ data: {} });
});

describe('submit is blocked until required fields are complete', () => {
  test('an empty draft cannot be submitted and lists what is missing', async () => {
    const user = userEvent.setup();
    render(<DraftEditor record={draft()} meta={META} reload={reload} />);

    submitButtons().forEach((b) => expect(b).toBeDisabled());
    expect(screen.getAllByText(/complete 3 more requirements to submit/i)[0]).toHaveTextContent(
      /shift summary, outstanding tasks, incoming staff member assigned/i,
    );
    await user.click(submitButtons()[0]);
    expect(api.post).not.toHaveBeenCalled();
  });

  test('stays blocked while any one requirement is missing', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<DraftEditor record={draft()} meta={META} reload={reload} />);

    await user.selectOptions(screen.getByLabelText(/incoming staff member/i), 'inc-1');
    await user.type(screen.getByLabelText(/shift summary/i), 'Too short');
    submitButtons().forEach((b) => expect(b).toBeDisabled());

    await user.type(screen.getByLabelText(/shift summary/i), ' - all stands clear tonight');
    // Summary and incoming done, but no task yet.
    submitButtons().forEach((b) => expect(b).toBeDisabled());
    expect(screen.getAllByText(/complete 1 more requirement to submit: outstanding tasks/i).length).toBeGreaterThan(0);

    rerender(<DraftEditor record={draft({ tasks: [TASK] })} meta={META} reload={reload} />);
    submitButtons().forEach((b) => expect(b).toBeEnabled());
  });

  test('a complete draft submits after confirmation', async () => {
    const user = userEvent.setup();
    api.post.mockResolvedValue({ data: { carried_forward: 0, notified: ['inc-1'] } });
    render(
      <DraftEditor
        record={draft({ summary_notes: 'All stands clear, two late arrivals handled.', incoming_user_id: 'inc-1', tasks: [TASK] })}
        meta={META}
        reload={reload}
      />,
    );

    submitButtons().forEach((b) => expect(b).toBeEnabled());
    await user.click(submitButtons()[0]);
    const dialog = await screen.findByRole('dialog');
    await user.click(Array.from(dialog.querySelectorAll('button')).find((b) => /submit handover/i.test(b.textContent)));

    expect(api.patch).toHaveBeenCalledWith('/handovers/rec-1', expect.objectContaining({ incoming_user_id: 'inc-1' }));
    expect(api.post).toHaveBeenCalledWith('/handovers/rec-1/submit');
  });
});
