import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '../context/AuthContext';
import PlayerHub from '../pages/player/PlayerHub';

// AppNav pulls in the polling NotificationBell — stub it out for this test.
vi.mock('../components/AppNav', () => ({ default: () => null }));

const { mockGet } = vi.hoisted(() => ({ mockGet: vi.fn() }));
vi.mock('../api/client', () => ({ api: { get: mockGet } }));

const CATALOG = {
  individual: [{
    code: 'season_goals', name: 'Goal Machine', description: 'Score goals across the season',
    category: 'performance', glyph: 'ball', unit: 'goals', isStreak: false,
    tiers: [{ tier: 'bronze', threshold: 1 }],
  }],
  team: [],
  tiers: ['bronze', 'silver', 'gold', 'platinum', 'diamond', 'champion', 'legend'],
};

const ACHIEVEMENTS = {
  player: { userId: 'u2', name: 'Maria Keeper', avatarUrl: null },
  seasonYear: 2026,
  earned: [{ code: 'season_goals', tier: 'gold', progress: null, earnedAt: null }],
  groups: [{ code: 'season_goals', value: null, highestTier: 'gold', nextThreshold: null }],
  streaks: [],
};

function statsFor(userId: string, name: string, signups: number | null) {
  return {
    player: { userId, name, preferredPositions: ['GK'], avatarUrl: null },
    seasonStats: {
      season_year: 2026, total_team_games: 10, total_played: 8,
      total_goals: 5, total_assists: 3, total_saves: 0, total_clean_sheets: 2,
      total_man_of_match: 1, total_yellow_cards: 0, total_red_cards: 0,
      gk_appearances: 4, total_signups: signups, avg_rating: 7.4, attendance_rate: 80,
    },
    availableSeasons: [{ year: 2026, label: '2026' }],
    recentMatches: [
      { matchId: 'm1', matchDate: '2026-05-01', attended: true, goals: 2, assists: 1, cleanSheet: false },
    ],
  };
}

function renderHub(path: string) {
  localStorage.setItem('user', JSON.stringify({ userId: 'u1', email: 'a@b.c', name: 'A', role: 'player', preferredPositions: [] }));
  localStorage.setItem('accessToken', 'tok');
  localStorage.setItem('lastActivity', String(Date.now()));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/players/:playerId" element={<PlayerHub />} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe('PlayerHub', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders a teammate's profile with stats, tier, and no signup card or edit link", async () => {
    mockGet.mockImplementation((url: string) => {
      if (url.startsWith('/players/u2/statistics')) return Promise.resolve({ data: { data: statsFor('u2', 'Maria Keeper', null) } });
      if (url.startsWith('/players/u2/achievements')) return Promise.resolve({ data: { data: ACHIEVEMENTS } });
      if (url === '/achievements') return Promise.resolve({ data: { data: CATALOG } });
      return Promise.resolve({ data: { data: {} } });
    });
    renderHub('/players/u2');

    expect(await screen.findByRole('heading', { name: /Maria Keeper/ })).toBeInTheDocument();
    // Stat cards from the mocked season stats.
    expect(await screen.findByText('Goals')).toBeInTheDocument();
    expect(screen.getByText('Assists')).toBeInTheDocument();
    // Overall tier from the earned crest (gold = 3+1 = 4 points → bronze rank).
    expect(await screen.findByText(/rank/)).toBeInTheDocument();
    // Signups are redacted for teammates → no card; not their own page → no edit link.
    expect(screen.queryByText('Signed up')).not.toBeInTheDocument();
    expect(screen.queryByText('Edit profile')).not.toBeInTheDocument();
  });

  it('shows the signup card and an Edit profile link on your own hub', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url.startsWith('/players/u1/statistics')) return Promise.resolve({ data: { data: statsFor('u1', 'Ana Own', 4) } });
      if (url.startsWith('/players/u1/achievements')) return Promise.resolve({ data: { data: { ...ACHIEVEMENTS, player: { userId: 'u1', name: 'Ana Own', avatarUrl: null } } } });
      if (url === '/achievements') return Promise.resolve({ data: { data: CATALOG } });
      return Promise.resolve({ data: { data: {} } });
    });
    renderHub('/players/u1');

    expect(await screen.findByRole('heading', { name: /Ana Own/ })).toBeInTheDocument();
    expect(await screen.findByText('Signed up')).toBeInTheDocument();
    const edit = screen.getByRole('link', { name: 'Edit profile' });
    expect(edit).toHaveAttribute('href', '/settings');
  });

  it('renders a not-found state when the player does not exist', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/statistics')) return Promise.reject({ response: { status: 404 } });
      return Promise.resolve({ data: { data: {} } });
    });
    renderHub('/players/nope');

    expect(await screen.findByText('Player not found.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Back to team stats/ })).toHaveAttribute('href', '/statistics');
  });
});
