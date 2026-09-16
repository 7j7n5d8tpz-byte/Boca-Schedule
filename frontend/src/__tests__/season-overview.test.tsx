import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import SeasonOverview from '../pages/coach/SeasonOverview';

// AppNav pulls in the polling NotificationBell — stub it out for this test.
vi.mock('../components/AppNav', () => ({ default: () => null }));

const { mockGet } = vi.hoisted(() => ({ mockGet: vi.fn() }));
vi.mock('../api/client', () => ({ api: { get: mockGet } }));

const match = (matchId: string, matchDate: string, opponent: string, status: string, signupCount: number, selectedCount: number) => ({
  matchId, matchDate, matchTime: '18:00:00', matchType: '7-player', matchCategory: 'serie',
  opponent, status, minPlayers: 7, maxPlayers: 10, signupCount, selectedCount,
});

const OVERVIEW = {
  year: 2026, seasonLabel: '2026', availableSeasons: [{ year: 2026, label: '2026' }],
  matches: [
    match('m1', '2026-04-01', 'Hyrderne FC', 'completed', 9, 8),
    match('m2', '2026-10-01', 'Premier United', 'signup_open', 6, 0),
  ],
  players: [
    { userId: 'p1', name: 'Ajay', played: 7, selected: 7, considered: 8, selectionPct: 87.5, cells: { m1: 'played', m2: 'signed_up' } },
    { userId: 'p2', name: 'Aske', played: 0, selected: 0, considered: 0, selectionPct: null, cells: { m1: 'none', m2: 'missing' } },
    { userId: 'p3', name: 'Chris', played: 3, selected: 3, considered: 4, selectionPct: 75, cells: { m1: 'withdrawn', m2: 'withdrawn' } },
  ],
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <SeasonOverview />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Coach season overview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockResolvedValue({ data: { data: OVERVIEW } });
  });

  it('shows per-player totals and a state per match', async () => {
    renderPage();
    const ajay = (await screen.findByRole('rowheader', { name: /Ajay/ })).closest('tr')!;
    expect(within(ajay).getByText('7')).toBeInTheDocument();
    expect(within(ajay).getByText('88%')).toBeInTheDocument();

    // No decided sign-ups → no percentage, and the open match is flagged as unanswered.
    const aske = screen.getByRole('rowheader', { name: /Aske/ }).closest('tr')!;
    expect(within(aske).getByText('–', { selector: 'button.tabular-nums' })).toBeInTheDocument();
    expect(within(aske).getAllByRole('img').map(el => el.getAttribute('aria-label'))).toEqual(['Not signed up', 'No reply']);
  });

  it('counts players with no reply to an open match', async () => {
    renderPage();
    const chip = await screen.findByTitle(/neither signed up nor withdrawn/);
    expect(within(chip).getByText('1')).toBeInTheDocument();
  });

  it('filters to open matches and sorts by played', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('rowheader', { name: /Ajay/ });
    expect(screen.getAllByRole('columnheader')).toHaveLength(3);

    await user.click(screen.getByRole('button', { name: 'Open only' }));
    expect(screen.getAllByRole('columnheader')).toHaveLength(2);

    await user.selectOptions(screen.getByLabelText('Sort'), 'played');
    expect(screen.getAllByRole('rowheader').map(r => r.textContent)).toEqual([
      expect.stringContaining('Ajay'), expect.stringContaining('Chris'), expect.stringContaining('Aske'),
    ]);
  });
});
