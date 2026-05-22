import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import RavenIcon from '../../components/RavenIcon';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, LineChart, Line, RadarChart, Radar,
  PolarGrid, PolarAngleAxis, PolarRadiusAxis,
} from 'recharts';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';

interface PlayerStat {
  userId: string;
  name: string;
  preferredPositions: string[];
  totalSignups: number;
  totalSelected: number;
  totalPlayed: number;
  totalGoals: number;
  totalAssists: number;
  totalSaves: number;
  avgRating: number;
  attendanceRate: number;
}

interface MatchHistory {
  matchId: string;
  matchDate: string;
  location: string;
  opponent: string | null;
  goalsFor: number;
  goalsAgainst: number;
}

interface Overview {
  totalPlayers: number;
  totalGoals: number;
  totalGoalsAgainst: number;
  totalAssists: number;
  totalSaves: number;
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
  saves: '#10b981',
  attendance: '#f59e0b',
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
  return (
    <div className="bg-white border border-gray-200 rounded-lg px-3 py-2 shadow text-xs">
      <p className="font-medium text-gray-700 mb-1">{label}</p>
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
  const { user, logout } = useAuth();
  const [selectedPlayer, setSelectedPlayer] = useState<string>('');
  const [selectedYear, setSelectedYear] = useState<number | null>(null);

  const { data: myPermission } = useQuery({
    queryKey: ['my-permission'],
    queryFn: () => api.get('/result-permissions/my').then(r => r.data.data),
  });

  const isCoach = user?.role === 'coach' || user?.role === 'admin';
  const canEnterResults = isCoach || myPermission?.canEnterResults;

  const { data, isLoading } = useQuery<TeamStats>({
    queryKey: ['team-statistics', selectedYear],
    queryFn: () => api.get(`/players/statistics/team${selectedYear ? `?year=${selectedYear}` : ''}`).then(r => r.data.data),
    staleTime: 60_000,
  });

  const { data: playerDetail } = useQuery({
    queryKey: ['player-stats', selectedPlayer],
    queryFn: () => api.get(`/players/${selectedPlayer}/statistics`).then(r => r.data.data),
    enabled: !!selectedPlayer,
  });

  const { data: resultMatches } = useQuery<{ matchId: string; matchDate: string; matchTime: string; location: string; status: string }[]>({
    queryKey: ['result-matches'],
    queryFn: () =>
      api.get('/matches/upcoming?status=published,completed').then(r => r.data.data.matches ?? []),
    enabled: !!canEnterResults,
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
    'Goals for': m.goalsFor,
    'Goals against': m.goalsAgainst,
    result: m.goalsFor > m.goalsAgainst ? 'W' : m.goalsFor < m.goalsAgainst ? 'L' : 'D',
  }));

  // Leaderboard data
  const topScorers   = [...players].sort((a, b) => b.totalGoals - a.totalGoals).slice(0, 7);
  const topAssisters = [...players].sort((a, b) => b.totalAssists - a.totalAssists).slice(0, 7);
  const topKeepers   = players.filter(p => p.preferredPositions.includes('GK'))
    .sort((a, b) => b.totalSaves - a.totalSaves).slice(0, 5);
  const topAttenders = [...players].sort((a, b) => b.attendanceRate - a.attendanceRate).slice(0, 7);

  const maxGoals    = topScorers[0]?.totalGoals ?? 1;
  const maxAssists  = topAssisters[0]?.totalAssists ?? 1;
  const maxSaves    = topKeepers[0]?.totalSaves ?? 1;
  const maxAttend   = 100;

  // Radar data for selected player
  const radarData = focusPlayer ? [
    { metric: 'Attendance', value: Math.round(focusPlayer.attendanceRate), full: 100 },
    ...((isCoach || focusPlayer.userId === user?.userId) ? [{ metric: 'Selected %', value: focusPlayer.totalSignups ? Math.round(focusPlayer.totalSelected / focusPlayer.totalSignups * 100) : 0, full: 100 }] : []),
    { metric: 'Goals/game', value: focusPlayer.totalPlayed ? +(focusPlayer.totalGoals / focusPlayer.totalPlayed * 10).toFixed(0) : 0, full: 20 },
    { metric: 'Assists/game', value: focusPlayer.totalPlayed ? +(focusPlayer.totalAssists / focusPlayer.totalPlayed * 10).toFixed(0) : 0, full: 20 },
    { metric: 'Saves/game', value: focusPlayer.totalPlayed ? +(focusPlayer.totalSaves / focusPlayer.totalPlayed * 10).toFixed(0) : 0, full: 50 },
  ] : [];

  // Per-match history for selected player
  const playerMatchData = (playerDetail?.recentMatches ?? [])
    .filter((m: any) => m.attended)
    .reverse()
    .map((m: any) => ({
      name: fmtDate(m.matchDate),
      Goals: m.goals ?? 0,
      Assists: m.assists ?? 0,
      Saves: m.saves ?? 0,
    }));

  const hasMatchResults = matchHistory.length > 0;
  const hasPerformance  = players.some(p => p.totalGoals > 0 || p.totalAssists > 0 || p.totalSaves > 0);

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-brand-dark border-b border-brand-green/40 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link to="/dashboard" className="text-white/50 hover:text-white/80 text-sm">← Dashboard</Link>
          <span className="text-white/20">|</span>
          <div className="flex items-center gap-2">
            <RavenIcon className="w-5 h-5 text-white" />
            <span className="font-bold text-white text-lg">Boca Schedule</span>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <Link to="/profile" className="text-sm text-white/70 hover:text-white">{user?.name}</Link>
          <button onClick={logout} className="text-sm text-white/60 hover:text-white/90">Logout</button>
        </div>
      </nav>

      <main className="max-w-5xl mx-auto px-4 py-8 space-y-8">

        {/* Header + controls */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
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
          </div>
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
        </div>

        {isLoading && (
          <div className="text-center text-gray-400 py-16">Loading statistics…</div>
        )}

        {!isLoading && !selectedPlayer && overview && (
          <>
            {/* Overview cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <StatCard label="Players" value={overview.totalPlayers} />
              <StatCard
                label="Record"
                value={overview.gamesWithResults > 0 ? `${overview.wins}W ${overview.draws}D ${overview.losses}L` : '—'}
                sub={overview.gamesWithResults > 0 ? `${overview.gamesWithResults} games` : 'No results yet'}
              />
              <StatCard
                label="Goals for / against"
                value={overview.gamesWithResults > 0 ? `${overview.totalGoals} / ${overview.totalGoalsAgainst}` : '—'}
                sub={overview.gamesWithResults > 0 ? `Avg ${overview.avgGoalsFor} / ${overview.avgGoalsAgainst}` : undefined}
                color={overview.totalGoals >= overview.totalGoalsAgainst ? 'text-green-600' : 'text-red-500'}
              />
              <StatCard label="Avg attendance" value={`${overview.avgAttendanceRate}%`} />
            </div>

            {/* Honours row */}
            {(overview.topScorer || overview.topAssister || overview.topKeeper) && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {overview.topScorer && (
                  <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-center gap-3">
                    <span className="text-2xl">⚽</span>
                    <div>
                      <p className="text-xs text-gray-500">Top scorer</p>
                      <p className="font-semibold text-gray-900">{overview.topScorer.name}</p>
                      <p className="text-sm text-brand-green">{overview.topScorer.value} goals</p>
                    </div>
                  </div>
                )}
                {overview.topAssister && (
                  <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-center gap-3">
                    <span className="text-2xl">🎯</span>
                    <div>
                      <p className="text-xs text-gray-500">Most assists</p>
                      <p className="font-semibold text-gray-900">{overview.topAssister.name}</p>
                      <p className="text-sm text-purple-600">{overview.topAssister.value} assists</p>
                    </div>
                  </div>
                )}
                {overview.topKeeper && (
                  <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-center gap-3">
                    <span className="text-2xl">🧤</span>
                    <div>
                      <p className="text-xs text-gray-500">Most saves</p>
                      <p className="font-semibold text-gray-900">{overview.topKeeper.name}</p>
                      <p className="text-sm text-green-600">{overview.topKeeper.value} saves</p>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Record results — visible to coaches and authorized users */}
            {canEnterResults && (resultMatches ?? []).length > 0 && (
              <div className="space-y-2">
                <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Record results</h2>
                {(resultMatches ?? []).map(m => (
                  <Link
                    key={m.matchId}
                    to={`/matches/${m.matchId}/results`}
                    className="flex items-center justify-between bg-white rounded-xl border border-gray-200 px-5 py-3 hover:border-brand-green-400 transition-colors"
                  >
                    <div>
                      <p className="text-sm font-medium text-gray-900">
                        {new Date(m.matchDate).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
                        {' · '}{m.matchTime.slice(0, 5)}
                      </p>
                      <p className="text-xs text-gray-400">{m.location}</p>
                    </div>
                    <span className="text-xs text-brand-green font-medium">Enter result →</span>
                  </Link>
                ))}
              </div>
            )}

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
                    <Bar dataKey="Goals for"     fill={CHART_COLORS.goals}   radius={[3, 3, 0, 0]} />
                    <Bar dataKey="Goals against" fill={CHART_COLORS.against} radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
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
                      label: 'Record',
                      curr: data.overview.gamesWithResults > 0
                        ? `${data.overview.wins}W ${data.overview.draws}D ${data.overview.losses}L`
                        : '—',
                      prev: data.prevOverview.gamesWithResults > 0
                        ? `${data.prevOverview.wins}W ${data.prevOverview.draws}D ${data.prevOverview.losses}L`
                        : '—',
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
                    {
                      label: 'Avg attendance',
                      curr: data.overview.avgAttendanceRate > 0 ? `${data.overview.avgAttendanceRate}%` : '—',
                      prev: data.prevOverview.avgAttendanceRate > 0 ? `${data.prevOverview.avgAttendanceRate}%` : '—',
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

                {/* GK saves */}
                {topKeepers.length > 0 && topKeepers[0].totalSaves > 0 && (
                  <div className="bg-white rounded-xl border border-gray-200 p-5">
                    <h2 className="text-sm font-semibold text-gray-700 mb-3">🧤 GK saves</h2>
                    {topKeepers.map(p => (
                      <LeaderBar key={p.userId} name={p.name} value={p.totalSaves}
                        max={maxSaves} color={CHART_COLORS.saves} isMe={p.userId === user?.userId} />
                    ))}
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
                      {['Player', ...(isCoach ? ['Signed up', 'Selected'] : []), 'Played', 'Attendance', 'Goals', 'Assists', 'Saves'].map(h => (
                        <th key={h} className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
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
                          {isCoach && <td className="px-3 py-2.5 text-center text-gray-700">{p.totalSignups}</td>}
                          {isCoach && <td className="px-3 py-2.5 text-center text-gray-700">{p.totalSelected}</td>}
                          <td className="px-3 py-2.5 text-center text-gray-700">{p.totalPlayed}</td>
                          <td className="px-3 py-2.5 text-center">
                            <span className={`text-xs font-medium ${p.attendanceRate >= 75 ? 'text-green-600' : p.attendanceRate >= 50 ? 'text-amber-600' : p.totalSignups === 0 ? 'text-gray-300' : 'text-red-500'}`}>
                              {p.totalSignups === 0 ? '—' : `${p.attendanceRate.toFixed(0)}%`}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-center text-gray-700">{p.totalGoals}</td>
                          <td className="px-3 py-2.5 text-center text-gray-700">{p.totalAssists}</td>
                          <td className="px-3 py-2.5 text-center text-gray-700">{p.totalSaves}</td>
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
        {!isLoading && selectedPlayer && focusPlayer && (
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
              {(isCoach || focusPlayer.userId === user?.userId) && <StatCard label="Selected"  value={focusPlayer.totalSelected} />}
              <StatCard label="Played"     value={focusPlayer.totalPlayed} />
              <StatCard label="Attendance" value={focusPlayer.totalSignups === 0 ? '—' : `${focusPlayer.attendanceRate.toFixed(0)}%`} />
              <StatCard label="Goals"      value={focusPlayer.totalGoals} sub={focusPlayer.totalPlayed > 0 ? `${(focusPlayer.totalGoals / focusPlayer.totalPlayed).toFixed(2)}/game` : undefined} />
              <StatCard label="Assists"    value={focusPlayer.totalAssists} sub={focusPlayer.totalPlayed > 0 ? `${(focusPlayer.totalAssists / focusPlayer.totalPlayed).toFixed(2)}/game` : undefined} />
              <StatCard label="Saves"      value={focusPlayer.totalSaves} sub={focusPlayer.totalPlayed > 0 ? `${(focusPlayer.totalSaves / focusPlayer.totalPlayed).toFixed(2)}/game` : undefined} />
              <StatCard label="Avg rating" value={focusPlayer.avgRating > 0 ? focusPlayer.avgRating.toFixed(1) : '—'} />
            </div>

            {/* Radar chart */}
            {radarData.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <h2 className="text-sm font-semibold text-gray-700 mb-2">Player profile</h2>
                <ResponsiveContainer width="100%" height={260}>
                  <RadarChart data={radarData}>
                    <PolarGrid stroke="#e5e7eb" />
                    <PolarAngleAxis dataKey="metric" tick={{ fontSize: 11 }} />
                    <PolarRadiusAxis angle={90} domain={[0, 'auto']} tick={{ fontSize: 9 }} />
                    <Radar name={focusPlayer.name} dataKey="value" stroke={CHART_COLORS.goals} fill={CHART_COLORS.goals} fillOpacity={0.25} />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Per-match performance */}
            {playerMatchData.length > 0 ? (
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <h2 className="text-sm font-semibold text-gray-700 mb-4">Goals · Assists · Saves per match</h2>
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={playerMatchData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                    <Tooltip content={<ResultTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Line type="monotone" dataKey="Goals"   stroke={CHART_COLORS.goals}   strokeWidth={2} dot={{ r: 3 }} />
                    <Line type="monotone" dataKey="Assists" stroke={CHART_COLORS.assists} strokeWidth={2} dot={{ r: 3 }} />
                    <Line type="monotone" dataKey="Saves"   stroke={CHART_COLORS.saves}   strokeWidth={2} dot={{ r: 3 }} />
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

      </main>
    </div>
  );
}
