import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { expect, test, vi } from 'vitest';
import api from '../api';
import PrintRecord from '../pages/PrintRecord';
import { renderWithProviders } from './helpers';

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, default: { get: vi.fn(), post: vi.fn() } };
});

const EXPORT = {
  format: 'shms.handover_record.v1',
  exported_at: '2026-10-13T10:00:00Z',
  record: {
    record_id: 'rec-1', department_name: 'Ground Operations', shift_type: 'day', shift_start: '2026-10-13T04:00:00Z',
    status: 'under_review', outgoing_name: 'Olu Outgoing', incoming_name: 'Ivy Incoming', summary_notes: 'All stands clear.',
    template: { version: 2 },
    tasks: [{ task_id: 't1', description: 'Check GPU on stand 5', priority: 'high', status: 'open' }],
    incidents: [{ incident_id: 'i1', title: 'Fuel spill', severity: 'medium', occurred_at: '2026-10-13T06:00:00Z' }],
    acknowledgement: { ack_id: 'a1', confirmed_at: '2026-10-13T09:00:00Z', comments: 'Received' },
    reviews: [],
  },
  audit_log: [{
    log_id: '1', logged_at: '2026-10-13T09:30:00Z', user_name: 'Sam Supervisor', entity_type: 'handover_record', entity_id: 'rec-1-xxxx', action: 'open_review',
  }],
};

const renderAt = (id) => renderWithProviders(
  <Routes><Route path="/handovers/:id/print" element={<PrintRecord />} /></Routes>,
  { route: `/handovers/${id}/print` },
);

test('renders every section of the export', async () => {
  api.get.mockResolvedValue({ data: EXPORT });
  renderAt('rec-1');

  expect(await screen.findByText('Check GPU on stand 5')).toBeInTheDocument();
  expect(api.get).toHaveBeenCalledWith('/handovers/rec-1/export');
  expect(screen.getByText('Fuel spill')).toBeInTheDocument();
  expect(screen.getByText(/Comments: Received/)).toBeInTheDocument();
  expect(screen.getByText('No reviews.')).toBeInTheDocument();
  expect(screen.getByText('Review opened')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /print/i })).toBeEnabled();
});

test('shows the API error when access is refused', async () => {
  api.get.mockRejectedValue({ response: { status: 403, data: { error: 'Resource belongs to another department' } } });
  renderAt('rec-2');
  expect(await screen.findByText('Resource belongs to another department')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /print/i })).toBeDisabled();
});
