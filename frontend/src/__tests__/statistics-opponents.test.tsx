import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../context/AuthContext';
import Statistics from '../pages/player/Statistics';

// AppNav pulls in the polling NotificationBell — stub it out for this test.
vi.mock('../components/AppNav', () => ({ default: () => null }));

const { mockGet } = vi.hoisted(() => ({ mockGet: vi.fn() }));
vi.mock('../api/client', () => ({ api: { get: mockGet } }));

const EMPTY_OVERVIEW = {
  totalPlayers: 0, totalGoals: 0, totalGoalsAgainst: 0, totalAssists: 0, totalCleanSheets: 0,
  avgAttendanceRate: 0, gamesWithResults: 0, wins: 0, draws: 0, losses: 0,
  avgGoalsFor: 0, avgGoalsAgainst: 0, topScorer: null, topAssister: null, topKeeper: null, topMotm: null,
};
const TEAM_STATS = {
  year: 2026, availableYears: [2026], overview: EMPTY_OVERVIEW,
  prevYear: 2025, prevOverview: EMPTY_OVERVIEW, players: [], matchHistory: [],
};
const OPPONENTS = [{ opponentId: 'opp-1', name: 'History Rovers', matchesPlayed: 3 }];
const HISTORY = {
  opponentId: 'opp-1', name: 'History Rovers',
  summary: {
    played: 3, wins: 1, draws: 1, losses: 1, goalsFor: 4, goalsAgainst: 3,
    avgGoalsFor: 1.3, avgGoalsAgainst: 1,
    biggestWin: null, biggestLoss: null,
    lastResult: { matchId: 'm3', matchDate: '2024-09-01', matchTime: '18:00', matchType: '7-player', location: 'X', goalsFor: 1, goalsAgainst: 2, gameAssessment: null },
  },
  matches: [
    { matchId: 'm1', matchDate: '2024-03-01', matchTime: '18:00', matchType: '7-player', location: 'X', goalsFor: 3, goalsAgainst: 1, gameAssessment: 'dominated' },
    { matchId: 'm3', matchDate: '2024-09-01', matchTime: '18:00', matchType: '7-player', location: 'X', goalsFor: 1, goalsAgainst: 2, gameAssessment: null },
  ],
};

function routeGet(url: string) {
  if (url.startsWith('/players/statistics/team')) return Promise.resolve({ data: { data: TEAM_STATS } });
  if (url.startsWith('/players/statistics/highlights')) return Promise.resolve({ data: { data: { highlights: [] } } });
  if (url.startsWith('/opponents/opp-1/history')) return Promise.resolve({ data: { data: HISTORY } });
  if (url.startsWith('/opponents')) return Promise.resolve({ data: { data: OPPONENTS } });
  return Promise.resolve({ data: { data: {} } });
}

function renderPage() {
  localStorage.setItem('user', JSON.stringify({ userId: 'u1', email: 'a@b.c', name: 'A', role: 'player', preferredPositions: [] }));
  localStorage.setItem('accessToken', 'tok');
  localStorage.setItem('lastActivity', String(Date.now()));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <MemoryRouter>
          <Statistics />
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe('Statistics — Opponents view', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockImplementation(routeGet);
  });

  it('shows the head-to-head summary and per-match list, and a row click opens highlights', async () => {
    const user = userEvent.setup();
    renderPage();

    // Open the Opponents tab, then pick an opponent.
    await user.click(await screen.findByRole('button', { name: /Opponent breakdown/ }));
    await user.selectOptions(await screen.findByLabelText('Opponent'), 'opp-1');

    // Summary cards (record & goals) render from the mocked history.
    expect(await screen.findByText('Goals (for / against)')).toBeInTheDocument();
    expect(screen.getByText('4 / 3')).toBeInTheDocument();
    // Trend chart heading.
    expect(screen.getByText('Goals for vs against — each meeting')).toBeInTheDocument();
    // Per-match result list (assessment label from one meeting).
    expect(screen.getAllByText('We dominated').length).toBeGreaterThan(0);

    // Clicking a match row switches to the highlights view.
    await user.click(screen.getAllByText('We dominated')[0]);
    await waitFor(() =>
      expect(screen.getByText(/No completed matches with results yet/)).toBeInTheDocument(),
    );
  });
});
