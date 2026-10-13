// FR-16: the search form sends keyword, status, shift and an EAT date range.
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import api from '../api';
import { Search } from '../pages/SupervisorPage';
import { renderWithProviders } from './helpers';

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } };
});

describe('search form (FR-16)', () => {
  test('sends the shift filter and EAT day bounds, and lists the results', async () => {
    api.get.mockResolvedValue({ data: [] });
    const user = userEvent.setup();
    renderWithProviders(<Search onOpen={() => {}} />);

    await user.selectOptions(screen.getByLabelText('Shift'), 'night');
    await user.type(screen.getByLabelText('From (EAT)'), '2026-10-01');
    await user.type(screen.getByLabelText('To (EAT)'), '2026-10-13');
    await user.type(screen.getByLabelText('Keyword'), 'GPU');
    await user.click(screen.getByRole('button', { name: 'Search' }));

    expect(api.get).toHaveBeenCalledWith('/handovers/search', {
      params: {
        q: 'GPU', shift_type: 'night', from: '2026-10-01T00:00:00+03:00', to: '2026-10-13T23:59:59.999+03:00',
      },
    });
    expect(await screen.findByText('0 results')).toBeInTheDocument();
  });

  test('blank fields are not sent', async () => {
    api.get.mockResolvedValue({ data: [] });
    const user = userEvent.setup();
    renderWithProviders(<Search onOpen={() => {}} />);
    await user.click(screen.getByRole('button', { name: 'Search' }));
    expect(api.get).toHaveBeenCalledWith('/handovers/search', { params: {} });
  });
});
