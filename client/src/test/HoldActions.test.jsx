// Phase 2: supervisor actions on a held report (approve / send back).
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import api from '../api';
import HoldActions from '../components/HoldActions';
import { renderWithProviders } from './helpers';

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, default: { get: vi.fn(), post: vi.fn() } };
});

const held = {
  record_id: 'rec-9',
  status: 'submitted',
  release_state: 'held',
  release_reasons: [{ code: 'keyword', text: "contains the word 'hazard'" }],
};

beforeEach(() => vi.clearAllMocks());

describe('HoldActions', () => {
  test('renders nothing unless the record is held', () => {
    const { container } = renderWithProviders(
      <HoldActions record={{ ...held, release_state: 'auto_released' }} onDone={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  test('shows the reasons and approves with one click', async () => {
    api.post.mockResolvedValue({ data: {} });
    const onDone = vi.fn();
    renderWithProviders(<HoldActions record={held} onDone={onDone} />);

    expect(screen.getByText("contains the word 'hazard'")).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Approve & release/ }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/handovers/rec-9/approve', {}));
    expect(onDone).toHaveBeenCalledWith('rec-9');
  });

  test('send back requires a note and posts it', async () => {
    api.post.mockResolvedValue({ data: {} });
    const onDone = vi.fn();
    renderWithProviders(<HoldActions record={held} onDone={onDone} />);

    await userEvent.click(screen.getByRole('button', { name: /Send back with a note/ }));
    const send = await screen.findByRole('button', { name: /^Send back$/ });
    expect(send).toBeDisabled(); // no note yet

    await userEvent.type(screen.getByLabelText(/What needs attention/), 'Name who contained the spill.');
    await userEvent.click(send);
    await waitFor(() => expect(api.post).toHaveBeenCalledWith(
      '/handovers/rec-9/send-back',
      { comments: 'Name who contained the spill.' },
    ));
    expect(onDone).toHaveBeenCalledWith('rec-9');
  });
});
