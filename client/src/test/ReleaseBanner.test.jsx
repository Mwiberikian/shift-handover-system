// Phase 2: the release decision as shown on a record's detail view.
import { screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import ReleaseBanner from '../components/ReleaseBanner';
import { HandoverDetail } from '../components/Handover';
import { renderWithProviders } from './helpers';

const baseRecord = {
  record_id: 'rec-1',
  department_name: 'Ground Operations',
  shift_type: 'day',
  shift_start: new Date().toISOString(),
  status: 'submitted',
  submitted_at: new Date().toISOString(),
  outgoing_name: 'Achieng Otieno',
  incoming_name: 'Collins Ouma',
  summary_notes: 'Fuel spill at stand 2 contained, area cordoned.',
  tasks: [],
  incidents: [],
};

describe('ReleaseBanner', () => {
  test('held: shows the banner with each reason and says it does not block', () => {
    renderWithProviders(<ReleaseBanner record={{
      ...baseRecord,
      release_state: 'held',
      release_reasons: [
        { code: 'incident_severity', text: "critical incident 'Fuel spill at stand 2'" },
        { code: 'keyword', text: "contains the word 'fuel spill'" },
      ],
    }}
    />);
    expect(screen.getByText('Held for approval')).toBeInTheDocument();
    expect(screen.getByText("critical incident 'Fuel spill at stand 2'")).toBeInTheDocument();
    expect(screen.getByText("contains the word 'fuel spill'")).toBeInTheDocument();
    expect(screen.getByText(/never blocks the next shift/)).toBeInTheDocument();
  });

  test('auto-released: shows the checks-passed label with the date', () => {
    renderWithProviders(<ReleaseBanner record={{
      ...baseRecord, release_state: 'auto_released', released_at: '2026-11-10T06:00:00Z', release_reasons: [],
    }}
    />);
    expect(screen.getByText(/Released automatically: checks passed/)).toBeInTheDocument();
  });

  test('approved: says a supervisor released it', () => {
    renderWithProviders(<ReleaseBanner record={{
      ...baseRecord, release_state: 'approved', released_at: '2026-11-10T06:00:00Z',
    }}
    />);
    expect(screen.getByText(/Approved by a supervisor/)).toBeInTheDocument();
  });

  test('records from before the feature (no release_state) show nothing', () => {
    const { container } = renderWithProviders(<ReleaseBanner record={baseRecord} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('HandoverDetail carries the banner', () => {
  test('a held record shows the banner inside the full detail view', () => {
    renderWithProviders(<HandoverDetail record={{
      ...baseRecord,
      release_state: 'held',
      release_reasons: [{ code: 'keyword', text: "contains the word 'spill'" }],
    }}
    />);
    expect(screen.getByText('Held for approval')).toBeInTheDocument();
    expect(screen.getByText("contains the word 'spill'")).toBeInTheDocument();
    // The rest of the record is still fully visible.
    expect(screen.getByText(/Fuel spill at stand 2 contained/)).toBeInTheDocument();
  });
});
