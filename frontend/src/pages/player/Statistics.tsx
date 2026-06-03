import AppNav from '../../components/AppNav';
import { useState, useMemo, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, LineChart, Line, RadarChart, Radar,
  PolarGrid, PolarAngleAxis, PolarRadiusAxis,
} from 'recharts';

function RadarTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  return (
    <div className="bg-white border border-gray-200 rounded-lg px-3 py-2 shadow text-xs">
      <p className="font-semibold text-gray-700">{d.metric}</p>
      <p className="text-gray-900">{d.display}</p>
    </div>
  );
}
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { Skeleton } from '../../components/Skeleton';

interface PlayerStat {
  userId: string;
  name: string;
  preferredPositions: string[];
  totalSignups: number;
  totalPlayed: number;
  totalGoals: number;
  totalAssists: number;
  totalCleanSheets: number;
  totalYellowCards: number;
  totalRedCards: number;
  totalManOfMatch: number;
  avgRating: number;
  attendanceRate: number;
  gkAppearances: number;
}

interface MatchHistory {
  matchId: string;
  matchDate: string;
  location: string;
  opponent: string | null;
  goalsFor: number;
  goalsAgainst: number;
}

interface MatchHighlight {
  matchId: string;
  matchDate: string;
  matchTime: string;
  location: string;
  opponent: string | null;
  matchType: string;
  goalsFor: number;
  goalsAgainst: number;
  gameAssessment: string | null;
  goals: { scorerName: string | null; assisterName: string | null }[];
  cleanSheets: string[];
  yellowCards: string[];
  redCards: string[];
  manOfMatch: string | null;
  longRead: string | null;
  players: { name: string; isScorer: boolean; isAssister: boolean; isGoalkeeper: boolean }[];
}

interface Overview {
  totalPlayers: number;
  totalGoals: number;
  totalGoalsAgainst: number;
  totalAssists: number;
  totalCleanSheets: number;
  avgAttendanceRate: number;
  gamesWithResults: number;
  wins: number;
  draws: number;
  losses: number;
  avgGoalsFor: number;
  avgGoalsAgainst: number;
  topScorer: { name: string; value: number } | null;
  topAssister: { name: string; value: number } | null;
  topKeeper: { name: string; value: number } | null;
  topMotm: { name: string; value: number } | null;
}

interface TeamStats {
  year: number;
  availableYears: number[];
  overview: Overview;
  prevYear: number;
  prevOverview: Overview;
  players: PlayerStat[];
  matchHistory: MatchHistory[];
}

const POS_COLOR: Record<string, string> = {
  GK: 'bg-yellow-100 text-yellow-700',
  DEF: 'bg-blue-100 text-blue-700',
  WIN: 'bg-green-100 text-green-700',
  MID: 'bg-purple-100 text-purple-700',
  STR: 'bg-red-100 text-red-700',
};

const CHART_COLORS = {
  goals: '#1a6b3a',
  against: '#f87171',
  assists: '#8b5cf6',
  cleanSheets: '#10b981',
  attendance: '#f59e0b',
};

const ASSESSMENT_LABEL: Record<string, { label: string; color: string }> = {
  dominated:          { label: 'We dominated',      color: 'text-green-700' },
  strong_performance: { label: 'Strong performance', color: 'text-green-600' },
  even_game:          { label: 'Even game',          color: 'text-gray-600'  },
  unlucky:            { label: 'Unlucky',            color: 'text-amber-600' },
  tough_game:         { label: 'Tough game',         color: 'text-orange-600'},
  off_day:            { label: 'Off day',            color: 'text-red-600'   },
};

// ─── Small stat card ──────────────────────────────────────────────────────────

function StatCard({ label, value, sub, color = 'text-gray-900' }: {
  label: string; value: string | number; sub?: string; color?: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      <p className="text-xs text-gray-500 mt-0.5">{label}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

// ─── Match label formatter ────────────────────────────────────────────────────

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

// ─── Custom tooltip ───────────────────────────────────────────────────────────

function ResultTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  return (
    <div className="bg-white border border-gray-200 rounded-lg px-3 py-2 shadow text-xs">
      <p className="font-medium text-gray-700">{label}</p>
      {d?.opponent && <p className="text-gray-400 mb-1">{d.date}</p>}
      {!d?.opponent && <div className="mb-1" />}
      {payload.map((entry: any) => (
        <p key={entry.name} style={{ color: entry.color }}>
          {entry.name}: <span className="font-semibold">{entry.value}</span>
        </p>
      ))}
    </div>
  );
}

// ─── Horizontal leaderboard bar ───────────────────────────────────────────────

function LeaderBar({ name, value, max, color, isMe }: {
  name: string; value: number; max: number; color: string; isMe: boolean;
}) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className={`flex items-center gap-3 py-1.5 ${isMe ? 'font-semibold' : ''}`}>
      <span className="text-xs text-gray-700 w-28 truncate shrink-0">
        {name}{isMe && <span className="text-brand-green ml-1 text-[10px]">you</span>}
      </span>
      <div className="flex-1 bg-gray-100 rounded-full h-2">
        <div
          className="h-2 rounded-full transition-all"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
      <span className="text-xs font-medium text-gray-600 w-4 text-right">{value}</span>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Statistics() {
  const { user } = useAuth();
  const [selectedPlayer, setSelectedPlayer] = useState<string>('');
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [matchTypeFilter, setMatchTypeFilter] = useState<'all' | '7-player' | 'futsal'>('all');
  const [view, setView] = useState<'team' | 'highlights'>('team');
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);
  const highlightRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const isCoach = user?.role === 'coach' || user?.role === 'admin';

  const { data, isLoading } = useQuery<TeamStats>({
    queryKey: ['team-statistics', selectedYear, matchTypeFilter],
    queryFn: () => {
      const params = new URLSearchParams();
      if (selectedYear) params.set('year', String(selectedYear));
      if (matchTypeFilter !== 'all') params.set('matchType', matchTypeFilter);
      const qs = params.toString();
      return api.get(`/players/statistics/team${qs ? `?${qs}` : ''}`).then(r => r.data.data);
    },
    staleTime: 60_000,
  });

  const { data: playerDetail } = useQuery({
    queryKey: ['player-stats', selectedPlayer],
    queryFn: () => api.get(`/players/${selectedPlayer}/statistics`).then(r => r.data.data),
    enabled: !!selectedPlayer,
  });

  const { data: highlightsData, isLoading: highlightsLoading } = useQuery<{ highlights: MatchHighlight[] }>({
    queryKey: ['match-highlights', selectedYear, matchTypeFilter],
    queryFn: () => {
      const params = new URLSearchParams();
      if (selectedYear) params.set('year', String(selectedYear));
      if (matchTypeFilter !== 'all') params.set('matchType', matchTypeFilter);
      const qs = params.toString();
      return api.get(`/players/statistics/highlights${qs ? `?${qs}` : ''}`).then(r => r.data.data);
    },
    staleTime: 60_000,
    enabled: view === 'highlights',
  });

  const overview = data?.overview;
  const players = data?.players ?? [];
  const matchHistory = data?.matchHistory ?? [];

  const focusPlayer = useMemo(
    () => players.find(p => p.userId === selectedPlayer) ?? null,
    [players, selectedPlayer]
  );

  // Build data for goals/against chart
  const goalsChartData = matchHistory.map(m => ({
    name: m.opponent ? `vs ${m.opponent}` : fmtDate(m.matchDate),
    date: fmtDate(m.matchDate),
    opponent: m.opponent,
    matchId: m.matchId,
    'Goals for': m.goalsFor,
    'Goals against': m.goalsAgainst,
    result: m.goalsFor > m.goalsAgainst ? 'W' : m.goalsFor < m.goalsAgainst ? 'L' : 'D',
  }));

  // Leaderboard data
  const topScorers   = [...players].sort((a, b) => b.totalGoals - a.totalGoals).slice(0, 7);
  const topAssisters = [...players].sort((a, b) => b.totalAssists - a.totalAssists).slice(0, 7);
  const topCleanSheets = [...players].sort((a, b) => b.totalCleanSheets - a.totalCleanSheets).slice(0, 5);
  const topAttenders = [...players]
    .sort((a, b) => b.attendanceRate - a.attendanceRate).slice(0, 7);
  const gkLeaderboard = [...players]
    .filter(p => p.gkAppearances > 0)
    .sort((a, b) => b.gkAppearances - a.gkAppearances || b.totalCleanSheets - a.totalCleanSheets);
  const cardedPlayers = [...players]
    .filter(p => p.totalYellowCards > 0 || p.totalRedCards > 0)
    .sort((a, b) => (b.totalYellowCards + b.totalRedCards * 2) - (a.totalYellowCards + a.totalRedCards * 2));

  const maxGoals       = topScorers[0]?.totalGoals ?? 1;
  const maxAssists     = topAssisters[0]?.totalAssists ?? 1;
  const maxCleanSheets = topCleanSheets[0]?.totalCleanSheets ?? 1;
  const maxAttend      = 100;

  // Radar data for selected player — all axes normalized to 0-100
  const played = focusPlayer?.totalPlayed ?? 0;
  const radarData = focusPlayer ? [
    {
      metric: 'Attendance',
      value: Math.round(focusPlayer.attendanceRate),
      display: `${Math.round(focusPlayer.attendanceRate)}%`,
    },
    {
      metric: 'Goals/game',
      value: played > 0 ? Math.min(100, Math.round(focusPlayer.totalGoals / played * 50)) : 0,
      display: played > 0 ? `${(focusPlayer.totalGoals / played).toFixed(2)} per game` : '0 per game',
    },
    {
      metric: 'Assists/game',
      value: played > 0 ? Math.min(100, Math.round(focusPlayer.totalAssists / played * 50)) : 0,
      display: played > 0 ? `${(focusPlayer.totalAssists / played).toFixed(2)} per game` : '0 per game',
    },
    {
      metric: 'Clean sheets',
      value: played > 0 ? Math.round(focusPlayer.totalCleanSheets / played * 100) : 0,
      display: played > 0 ? `${Math.round(focusPlayer.totalCleanSheets / played * 100)}% (${focusPlayer.totalCleanSheets} total)` : '0%',
    },
  ] : [];

  // Per-match history for selected player
  const playerMatchData = (playerDetail?.recentMatches ?? [])
    .filter((m: any) => m.attended)
    .reverse()
    .map((m: any) => ({
      name: fmtDate(m.matchDate),
      Goals: m.goals ?? 0,
      Assists: m.assists ?? 0,
      'Clean sheets': m.cleanSheet ? 1 : 0,
    }));

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [view]);

  useEffect(() => {
    if (!selectedMatchId || view !== 'highlights' || highlightsLoading) return;
    const el = highlightRefs.current.get(selectedMatchId);
    if (el) setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
  }, [selectedMatchId, view, highlightsLoading, highlightsData]);

  const hasMatchResults = matchHistory.length > 0;
  const hasPerformance  = players.some(p => p.totalGoals > 0 || p.totalAssists > 0 || p.totalCleanSheets > 0);

  return (
    <div className="min-h-screen bg-gray-50 boca-page">
      <AppNav backHref="/dashboard" backLabel="← Dashboard" />

      <main className="max-w-5xl mx-auto px-4 py-8">

        {/* Header + filters */}
        <div className="flex items-center justify-between gap-4 flex-wrap mb-8">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold text-gray-900">Team Statistics</h1>
            {(data?.availableYears ?? []).length > 0 && (
              <select
                value={selectedYear ?? data?.year ?? ''}
                onChange={e => { setSelectedYear(Number(e.target.value)); setSelectedPlayer(''); }}
                className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green bg-white"
              >
                {(data?.availableYears ?? []).map(y => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            )}
            {/* Match type filter */}
            <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm">
              {(['all', '7-player', 'futsal'] as const).map((type, i) => (
                <button
                  key={type}
                  onClick={() => setMatchTypeFilter(type)}
                  className={`px-3 py-1.5 transition-colors ${i > 0 ? 'border-l border-gray-200' : ''} ${
                    matchTypeFilter === type
                      ? 'bg-brand-green text-white'
                      : 'bg-white text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {type === 'all' ? 'All' : type === '7-player' ? '7-player' : 'Futsal'}
                </button>
              ))}
            </div>
          </div>
          {view === 'team' && (
            <select
              value={selectedPlayer}
              onChange={e => setSelectedPlayer(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green bg-white min-w-48"
            >
              <option value="">All players</option>
              {players.map(p => (
                <option key={p.userId} value={p.userId}>
                  {p.name}{p.userId === user?.userId ? ' (you)' : ''}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Sidebar + content layout */}
        <div className="flex flex-col sm:flex-row gap-6 items-start">

          {/* Sidebar — horizontal tab bar on mobile, sidebar on sm+ */}
          <nav className="w-full sm:w-44 shrink-0 bg-white rounded-xl border border-gray-200 p-2 flex sm:flex-col gap-1 sm:sticky sm:top-4">
            <button
              onClick={() => setView('team')}
              className={`flex-1 sm:flex-none text-center sm:text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                view === 'team' ? 'bg-brand-green text-white' : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              Team stats
            </button>
            <button
              onClick={() => setView('highlights')}
              className={`flex-1 sm:flex-none text-center sm:text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                view === 'highlights' ? 'bg-brand-green text-white' : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              Match highlights
            </button>
          </nav>

          {/* Main content */}
          <div className="flex-1 min-w-0 space-y-8">

        {/* ── Match highlights view ── */}
        {view === 'highlights' && (
          <div className="space-y-4">
            {highlightsLoading && (
              <div className="space-y-4">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-40 w-full rounded-xl" />
                ))}
              </div>
            )}
            {!highlightsLoading && (highlightsData?.highlights ?? []).length === 0 && (
              <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400 text-sm">
                No completed matches with results yet.
              </div>
            )}
            {(highlightsData?.highlights ?? []).map(h => {
              const date = new Date(h.matchDate + 'T' + h.matchTime);
              const result = h.goalsFor > h.goalsAgainst ? 'W' : h.goalsFor < h.goalsAgainst ? 'L' : 'D';
              const resultColor = result === 'W' ? 'bg-green-100 text-green-700' : result === 'L' ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-600';
              const assessment = h.gameAssessment ? ASSESSMENT_LABEL[h.gameAssessment] : null;
              const isHighlighted = h.matchId === selectedMatchId;
              return (
                <div
                  key={h.matchId}
                  ref={el => { if (el) highlightRefs.current.set(h.matchId, el); else highlightRefs.current.delete(h.matchId); }}
                  className={`bg-white rounded-xl border p-5 space-y-3 transition-all duration-300 ${isHighlighted ? 'border-brand-green ring-2 ring-brand-green/25' : 'border-gray-200'}`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-semibold text-gray-900">
                        {date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
                        {h.opponent && <span className="text-gray-500 font-normal"> · vs {h.opponent}</span>}
                      </p>
                      <p className="text-sm text-gray-500 mt-0.5">
                        {h.location}
                        <span className={`ml-2 text-xs font-medium px-1.5 py-0.5 rounded ${h.matchType === 'futsal' ? 'bg-orange-100 text-orange-700' : 'bg-gray-100 text-gray-500'}`}>
                          {h.matchType}
                        </span>
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-2xl font-bold text-gray-900">{h.goalsFor} – {h.goalsAgainst}</span>
                      <span className={`text-sm font-bold px-2 py-0.5 rounded-full ${resultColor}`}>{result}</span>
                    </div>
                  </div>

                  {assessment && (
                    <p className={`text-sm font-medium ${assessment.color}`}>{assessment.label}</p>
                  )}

                  {h.goals.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Goals</p>
                      {h.goals.map((g, i) => (
                        <p key={i} className="text-sm text-gray-700">
                          <span className="text-gray-400 mr-1">{i + 1}.</span>
                          <span className="font-medium">{g.scorerName ?? 'Unknown'}</span>
                          {g.assisterName && (
                            <span className="text-gray-400"> · assist: <span className="text-gray-600">{g.assisterName}</span></span>
                          )}
                        </p>
                      ))}
                    </div>
                  )}
                  {h.goals.length === 0 && h.goalsFor > 0 && (
                    <p className="text-xs text-gray-400 italic">Goal details not recorded.</p>
                  )}

                  {h.cleanSheets.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Clean sheets</p>
                      <p className="text-sm text-gray-700 mt-0.5">{h.cleanSheets.join(', ')}</p>
                    </div>
                  )}

                  {(h.yellowCards.length > 0 || h.redCards.length > 0) && (
                    <div className="flex gap-4 flex-wrap">
                      {h.yellowCards.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">🟨 Yellow cards</p>
                          <p className="text-sm text-gray-700 mt-0.5">{h.yellowCards.join(', ')}</p>
                        </div>
                      )}
                      {h.redCards.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">🟥 Red cards</p>
                          <p className="text-sm text-gray-700 mt-0.5">{h.redCards.join(', ')}</p>
                        </div>
                      )}
                    </div>
                  )}

                  {h.manOfMatch && (
                    <div className="flex items-center gap-2">
                      <span className="text-base">⭐</span>
                      <div>
                        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Man of the match</p>
                        <p className="text-sm font-semibold text-amber-600 mt-0.5">{h.manOfMatch}</p>
                      </div>
                    </div>
                  )}

                  <details className="group">
                    <summary className="cursor-pointer text-xs font-semibold text-gray-400 uppercase tracking-wide select-none list-none flex items-center gap-1">
                      <span className="transition-transform group-open:rotate-90 inline-block">›</span>
                      Match Details
                    </summary>
                    <div className="mt-2 space-y-3">
                      {h.players.length === 0 ? (
                        <p className="text-xs text-gray-400 italic">No player data recorded.</p>
                      ) : (
                        <div className="space-y-1">
                          {h.players.map((p, i) => (
                            <div key={i} className="flex items-center gap-2 text-sm">
                              <span className={`flex-1 ${p.isGoalkeeper ? 'font-semibold text-yellow-700' : 'text-gray-700'}`}>
                                {p.name}
                              </span>
                              {p.isGoalkeeper && (
                                <span className="text-xs px-1.5 py-0.5 rounded bg-yellow-100 text-yellow-700 font-semibold">GK</span>
                              )}
                              {p.isScorer && (
                                <span className="text-xs px-1.5 py-0.5 rounded bg-green-100 text-green-700 font-semibold">⚽ Goal</span>
                              )}
                              {p.isAssister && (
                                <span className="text-xs px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 font-semibold">A</span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                      {h.longRead && (
                        <div className="pt-2 border-t border-gray-100">
                          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Match Report</p>
                          <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{h.longRead}</p>
                        </div>
                      )}
                    </div>
                  </details>
                </div>
              );
            })}
          </div>
        )}

        {view === 'team' && isLoading && (
          <div className="space-y-8">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="bg-white rounded-xl border border-gray-200 p-4 space-y-2">
                  <Skeleton className="h-7 w-12" />
                  <Skeleton className="h-3 w-16" />
                </div>
              ))}
            </div>
            <Skeleton className="h-52 w-full rounded-xl" />
            <Skeleton className="h-64 w-full rounded-xl" />
          </div>
        )}

        {view === 'team' && !isLoading && !selectedPlayer && overview && (
          <>
            {/* Overview cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <StatCard label="Wins"   value={overview.gamesWithResults > 0 ? overview.wins   : '—'} color="text-green-600" />
              <StatCard label="Draws"  value={overview.gamesWithResults > 0 ? overview.draws  : '—'} />
              <StatCard label="Losses" value={overview.gamesWithResults > 0 ? overview.losses : '—'} color="text-red-500" />
              <StatCard
                label="Goals for / against"
                value={overview.gamesWithResults > 0 ? `${overview.totalGoals} / ${overview.totalGoalsAgainst}` : '—'}
                sub={overview.gamesWithResults > 0 ? `Avg ${overview.avgGoalsFor} / ${overview.avgGoalsAgainst}` : undefined}
                color={overview.totalGoals >= overview.totalGoalsAgainst ? 'text-green-600' : 'text-red-500'}
              />
            </div>

            {/* Honours row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-center gap-3">
                <span className="text-2xl">⚽</span>
                <div>
                  <p className="text-xs text-gray-500">Top scorer</p>
                  {overview.topScorer
                    ? <><p className="font-semibold text-gray-900">{overview.topScorer.name}</p><p className="text-sm text-brand-green">{overview.topScorer.value} goals</p></>
                    : <p className="text-sm text-gray-300">No data yet</p>}
                </div>
              </div>
              <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-center gap-3">
                <span className="text-2xl">🎯</span>
                <div>
                  <p className="text-xs text-gray-500">Most assists</p>
                  {overview.topAssister
                    ? <><p className="font-semibold text-gray-900">{overview.topAssister.name}</p><p className="text-sm text-purple-600">{overview.topAssister.value} assists</p></>
                    : <p className="text-sm text-gray-300">No data yet</p>}
                </div>
              </div>
              <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-center gap-3">
                <span className="text-2xl">🧤</span>
                <div>
                  <p className="text-xs text-gray-500">Most clean sheets</p>
                  {overview.topKeeper
                    ? <><p className="font-semibold text-gray-900">{overview.topKeeper.name}</p><p className="text-sm text-green-600">{overview.topKeeper.value} clean sheets</p></>
                    : <p className="text-sm text-gray-300">No data yet</p>}
                </div>
              </div>
              <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-center gap-3">
                <span className="text-2xl">⭐</span>
                <div>
                  <p className="text-xs text-gray-500">Top man of match</p>
                  {overview.topMotm
                    ? <><p className="font-semibold text-gray-900">{overview.topMotm.name}</p><p className="text-sm text-amber-500">{overview.topMotm.value}×</p></>
                    : <p className="text-sm text-gray-300">No data yet</p>}
                </div>
              </div>
            </div>


            {/* Goals for vs against chart */}
            {hasMatchResults ? (
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <h2 className="text-sm font-semibold text-gray-700 mb-4">Goals for vs against — per match</h2>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={goalsChartData} barCategoryGap="30%">
                    <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                    <Tooltip content={<ResultTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="Goals for"     fill={CHART_COLORS.goals}   radius={[3, 3, 0, 0]} cursor="pointer"
                      onClick={(data: any) => { if (data?.matchId) { setSelectedMatchId(data.matchId); setView('highlights'); } }} />
                    <Bar dataKey="Goals against" fill={CHART_COLORS.against} radius={[3, 3, 0, 0]} cursor="pointer"
                      onClick={(data: any) => { if (data?.matchId) { setSelectedMatchId(data.matchId); setView('highlights'); } }} />
                  </BarChart>
                </ResponsiveContainer>
                <p className="text-xs text-gray-400 mt-2 text-right">Click a bar to view match highlights</p>
              </div>
            ) : (
              <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400 text-sm">
                No match results recorded yet — results will appear here once matches are entered.
              </div>
            )}

            {/* Year comparison */}
            {data && (
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <h2 className="text-sm font-semibold text-gray-700 mb-4">
                  {data.year} vs {data.prevYear}
                </h2>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    {
                      label: 'Wins',
                      curr: data.overview.gamesWithResults > 0 ? data.overview.wins : '—',
                      prev: data.prevOverview.gamesWithResults > 0 ? data.prevOverview.wins : '—',
                    },
                    {
                      label: 'Draws',
                      curr: data.overview.gamesWithResults > 0 ? data.overview.draws : '—',
                      prev: data.prevOverview.gamesWithResults > 0 ? data.prevOverview.draws : '—',
                    },
                    {
                      label: 'Losses',
                      curr: data.overview.gamesWithResults > 0 ? data.overview.losses : '—',
                      prev: data.prevOverview.gamesWithResults > 0 ? data.prevOverview.losses : '—',
                    },
                    {
                      label: 'Goals for',
                      curr: data.overview.totalGoals || '—',
                      prev: data.prevOverview.totalGoals || '—',
                    },
                    {
                      label: 'Goals against',
                      curr: data.overview.totalGoalsAgainst || '—',
                      prev: data.prevOverview.totalGoalsAgainst || '—',
                    },
                  ].map(row => (
                    <div key={row.label} className="contents">
                      <div className="col-span-2 text-xs text-gray-400 uppercase tracking-wide pt-2 first:pt-0">{row.label}</div>
                      <div className="bg-brand-green-50 rounded-lg p-3 text-center">
                        <p className="text-xs text-gray-500 mb-0.5">{data.year}</p>
                        <p className="font-semibold text-gray-900">{row.curr}</p>
                      </div>
                      <div className="bg-gray-50 rounded-lg p-3 text-center">
                        <p className="text-xs text-gray-500 mb-0.5">{data.prevYear}</p>
                        <p className="font-semibold text-gray-500">{row.prev}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Leaderboards */}
            {hasPerformance && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Top scorers */}
                <div className="bg-white rounded-xl border border-gray-200 p-5">
                  <h2 className="text-sm font-semibold text-gray-700 mb-3">⚽ Top scorers</h2>
                  {topScorers.map(p => (
                    <LeaderBar key={p.userId} name={p.name} value={p.totalGoals}
                      max={maxGoals} color={CHART_COLORS.goals} isMe={p.userId === user?.userId} />
                  ))}
                </div>

                {/* Top assisters */}
                <div className="bg-white rounded-xl border border-gray-200 p-5">
                  <h2 className="text-sm font-semibold text-gray-700 mb-3">🎯 Top assisters</h2>
                  {topAssisters.map(p => (
                    <LeaderBar key={p.userId} name={p.name} value={p.totalAssists}
                      max={maxAssists} color={CHART_COLORS.assists} isMe={p.userId === user?.userId} />
                  ))}
                </div>

                {/* Clean sheets */}
                {topCleanSheets.length > 0 && topCleanSheets[0].totalCleanSheets > 0 && (
                  <div className="bg-white rounded-xl border border-gray-200 p-5">
                    <h2 className="text-sm font-semibold text-gray-700 mb-3">🧤 Clean sheets</h2>
                    {topCleanSheets.map(p => (
                      <LeaderBar key={p.userId} name={p.name} value={p.totalCleanSheets}
                        max={maxCleanSheets} color={CHART_COLORS.cleanSheets} isMe={p.userId === user?.userId} />
                    ))}
                  </div>
                )}

                {/* GK leaderboard */}
                {gkLeaderboard.length > 0 && (
                  <div className="bg-white rounded-xl border border-gray-200 p-5">
                    <h2 className="text-sm font-semibold text-gray-700 mb-3">🥅 Goalkeepers</h2>
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 pb-1 border-b border-gray-100">
                        <span className="text-xs text-gray-400 w-28 shrink-0">Player</span>
                        <span className="text-xs text-gray-400 w-16 text-center">Halves</span>
                        <span className="text-xs text-gray-400 w-16 text-center">Clean sheets</span>
                        <span className="text-xs text-gray-400 flex-1 text-right">CS rate</span>
                      </div>
                      {gkLeaderboard.map(p => {
                        const isMe = p.userId === user?.userId;
                        const csRate = p.gkAppearances > 0 ? Math.round((p.totalCleanSheets / p.gkAppearances) * 100) : 0;
                        return (
                          <div key={p.userId} className={`flex items-center gap-2 py-0.5 ${isMe ? 'font-semibold' : ''}`}>
                            <span className="text-xs text-gray-700 w-28 truncate shrink-0">
                              {p.name}{isMe && <span className="text-brand-green ml-1 text-[10px]">you</span>}
                            </span>
                            <span className="text-xs text-gray-600 w-16 text-center">{p.gkAppearances}</span>
                            <span className="text-xs text-gray-600 w-16 text-center">{p.totalCleanSheets}</span>
                            <span className={`text-xs font-medium flex-1 text-right ${csRate >= 50 ? 'text-green-600' : csRate >= 25 ? 'text-amber-600' : 'text-gray-500'}`}>
                              {csRate}%
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Attendance */}
                <div className="bg-white rounded-xl border border-gray-200 p-5">
                  <h2 className="text-sm font-semibold text-gray-700 mb-3">📅 Attendance rate</h2>
                  {topAttenders.filter(p => p.totalSignups > 0).map(p => (
                    <LeaderBar key={p.userId} name={p.name} value={Math.round(p.attendanceRate)}
                      max={maxAttend} color={CHART_COLORS.attendance} isMe={p.userId === user?.userId} />
                  ))}
                </div>

                {/* Cards */}
                {cardedPlayers.length > 0 && (
                  <div className="bg-white rounded-xl border border-gray-200 p-5">
                    <h2 className="text-sm font-semibold text-gray-700 mb-3">⚠️ Cards</h2>
                    <div className="space-y-1.5">
                      {cardedPlayers.map(p => {
                        const isMe = p.userId === user?.userId;
                        return (
                          <div key={p.userId} className={`flex items-center gap-3 py-1 ${isMe ? 'font-semibold' : ''}`}>
                            <span className="text-xs text-gray-700 w-28 truncate shrink-0">
                              {p.name}{isMe && <span className="text-brand-green ml-1 text-[10px]">you</span>}
                            </span>
                            <div className="flex gap-2">
                              {p.totalYellowCards > 0 && (
                                <span className="text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded">
                                  🟨 {p.totalYellowCards}
                                </span>
                              )}
                              {p.totalRedCards > 0 && (
                                <span className="text-xs font-medium text-red-700 bg-red-50 border border-red-200 px-2 py-0.5 rounded">
                                  🟥 {p.totalRedCards}
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Player table */}
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100">
                <h2 className="text-sm font-semibold text-gray-700">All players</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      {[
                        { label: 'Player',       cls: '' },
                        ...(isCoach ? [{ label: 'Signed up', cls: 'hidden sm:table-cell' }] : []),
                        { label: 'Games',        cls: '' },
                        { label: 'Attendance',   cls: '' },
                        { label: 'Goals',        cls: '' },
                        { label: 'Assists',      cls: '' },
                        { label: 'Clean sheets', cls: 'hidden sm:table-cell' },
                        { label: 'YC',           cls: 'hidden sm:table-cell' },
                        { label: 'RC',           cls: 'hidden sm:table-cell' },
                      ].map(h => (
                        <th key={h.label} className={`px-3 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap ${h.cls}`}>{h.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {players.map(p => {
                      const isMe = p.userId === user?.userId;
                      return (
                        <tr key={p.userId}
                          className={`cursor-pointer transition-colors ${isMe ? 'bg-brand-green-50' : 'hover:bg-gray-50'}`}
                          onClick={() => setSelectedPlayer(p.userId)}
                        >
                          <td className="px-3 py-2.5">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={`font-medium ${isMe ? 'text-blue-700' : 'text-gray-900'}`}>
                                {p.name}
                              </span>
                              {p.preferredPositions.map(pos => (
                                <span key={pos} className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${POS_COLOR[pos] ?? 'bg-gray-100 text-gray-500'}`}>{pos}</span>
                              ))}
                            </div>
                          </td>
                          {isCoach && <td className="hidden sm:table-cell px-3 py-2.5 text-center text-gray-700">{p.totalSignups}</td>}
                          <td className="px-3 py-2.5 text-center text-gray-700">{p.totalPlayed}</td>
                          <td className="px-3 py-2.5 text-center">
                            {(() => {
                              const rate = p.totalSignups > 0 ? p.attendanceRate : null;
                              return (
                                <span className={`text-xs font-medium ${rate === null ? 'text-gray-300' : rate >= 75 ? 'text-green-600' : rate >= 50 ? 'text-amber-600' : 'text-red-500'}`}>
                                  {rate === null ? '—' : `${rate.toFixed(0)}%`}
                                </span>
                              );
                            })()}
                          </td>
                          <td className="px-3 py-2.5 text-center text-gray-700">{p.totalGoals}</td>
                          <td className="px-3 py-2.5 text-center text-gray-700">{p.totalAssists}</td>
                          <td className="hidden sm:table-cell px-3 py-2.5 text-center text-gray-700">{p.totalCleanSheets}</td>
                          <td className="hidden sm:table-cell px-3 py-2.5 text-center">
                            {p.totalYellowCards > 0 ? <span className="text-xs font-medium text-amber-600">{p.totalYellowCards}</span> : <span className="text-gray-300">—</span>}
                          </td>
                          <td className="hidden sm:table-cell px-3 py-2.5 text-center">
                            {p.totalRedCards > 0 ? <span className="text-xs font-medium text-red-600">{p.totalRedCards}</span> : <span className="text-gray-300">—</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-gray-400 px-5 py-3">Click a row to view player details</p>
            </div>
          </>
        )}

        {/* ── Selected player view ── */}
        {view === 'team' && !isLoading && selectedPlayer && focusPlayer && (
          <>
            <div className="flex items-center gap-3">
              <button onClick={() => setSelectedPlayer('')} className="text-sm text-gray-400 hover:text-gray-600">← All players</button>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-xl font-bold text-gray-900">{focusPlayer.name}</h2>
                {focusPlayer.preferredPositions.map(pos => (
                  <span key={pos} className={`text-xs font-medium px-2 py-0.5 rounded-full ${POS_COLOR[pos] ?? 'bg-gray-100 text-gray-500'}`}>{pos}</span>
                ))}
              </div>
            </div>

            {/* Player stat cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {(isCoach || focusPlayer.userId === user?.userId) && <StatCard label="Signed up" value={focusPlayer.totalSignups} />}
              <StatCard label="Games"      value={focusPlayer.totalPlayed} />
              <StatCard label="Goals"      value={focusPlayer.totalGoals}        sub={focusPlayer.totalPlayed > 0 ? `${(focusPlayer.totalGoals        / focusPlayer.totalPlayed).toFixed(2)}/game` : undefined} />
              <StatCard label="Assists"    value={focusPlayer.totalAssists}      sub={focusPlayer.totalPlayed > 0 ? `${(focusPlayer.totalAssists      / focusPlayer.totalPlayed).toFixed(2)}/game` : undefined} />
              <StatCard label="Clean sheets" value={focusPlayer.totalCleanSheets} sub={focusPlayer.totalPlayed > 0 ? `${(focusPlayer.totalCleanSheets / focusPlayer.totalPlayed).toFixed(2)}/game` : undefined} />
              <StatCard label="Avg rating" value={focusPlayer.avgRating > 0 ? focusPlayer.avgRating.toFixed(1) : '—'} />
              {focusPlayer.totalManOfMatch > 0 && <StatCard label="Man of match" value={focusPlayer.totalManOfMatch} color="text-amber-500" />}
              {focusPlayer.totalYellowCards > 0 && <StatCard label="Yellow cards" value={focusPlayer.totalYellowCards} color="text-amber-500" />}
              {focusPlayer.totalRedCards > 0 && <StatCard label="Red cards" value={focusPlayer.totalRedCards} color="text-red-600" />}
            </div>

            {/* Radar chart */}
            {radarData.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <h2 className="text-sm font-semibold text-gray-700 mb-2">Player profile</h2>
                <ResponsiveContainer width="100%" height={260}>
                  <RadarChart data={radarData}>
                    <PolarGrid stroke="#e5e7eb" />
                    <PolarAngleAxis dataKey="metric" tick={{ fontSize: 11 }} />
                    <PolarRadiusAxis angle={90} domain={[0, 100]} tick={false} axisLine={false} />
                    <Tooltip content={<RadarTooltip />} />
                    <Radar name={focusPlayer.name} dataKey="value" stroke={CHART_COLORS.goals} fill={CHART_COLORS.goals} fillOpacity={0.25} />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Per-match performance */}
            {playerMatchData.length > 0 ? (
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <h2 className="text-sm font-semibold text-gray-700 mb-4">Goals · Assists · Clean sheets per match</h2>
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={playerMatchData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                    <Tooltip content={<ResultTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Line type="monotone" dataKey="Goals"   stroke={CHART_COLORS.goals}   strokeWidth={2} dot={{ r: 3 }} />
                    <Line type="monotone" dataKey="Assists" stroke={CHART_COLORS.assists} strokeWidth={2} dot={{ r: 3 }} />
                    <Line type="monotone" dataKey="Clean sheets" stroke={CHART_COLORS.cleanSheets} strokeWidth={2} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400 text-sm">
                No per-match performance data recorded yet.
              </div>
            )}
          </>
        )}

          </div> {/* end flex-1 content */}
        </div> {/* end flex sidebar+content */}

      </main>
    </div>
  );
}
