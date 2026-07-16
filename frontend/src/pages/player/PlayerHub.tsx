import { useEffect, useState } from 'react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ResponsiveContainer, LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip, Legend,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
} from 'recharts';
import AppNav from '../../components/AppNav';
import Avatar from '../../components/Avatar';
import Crest, { TIER_META } from '../../components/Crest';
import RankBar from '../../components/RankBar';
import BadgeDetailModal from '../../components/BadgeDetailModal';
import PlayerCrestStrip from '../../components/PlayerCrestStrip';
import StreakCard from '../../components/achievements/StreakCard';
import { Skeleton } from '../../components/Skeleton';
import {
  StatCard, ResultTooltip, RadarTooltip, fmtDate, CHART_COLORS, POS_COLOR,
} from '../../components/stats/statShared';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import {
  useCatalog, overallPoints, overallRank,
  type PlayerAchievements, type StreakResult,
} from '../../api/achievements';

interface SeasonStats {
  season_year: number;
  total_team_games: number;
  total_played: number;
  total_goals: number;
  total_assists: number;
  total_saves: number;
  total_clean_sheets: number;
  total_man_of_match: number;
  total_yellow_cards: number;
  total_red_cards: number;
  gk_appearances: number;
  total_signups: number | null;
  avg_rating: number;
  attendance_rate: number;
}

interface RecentMatch {
  matchId: string;
  matchDate: string;
  attended: boolean;
  goals: number | null;
  assists: number | null;
  cleanSheet: boolean;
}

interface PlayerStatsResponse {
  player: { userId: string; name: string; preferredPositions: string[] | null; avatarUrl: string | null };
  seasonStats: SeasonStats;
  availableSeasons: { year: number; label: string }[];
  recentMatches: RecentMatch[];
}

type MatchTypeFilter = 'all' | '7-player' | 'futsal';

// Central hub for one player: photo, positions, overall tier, season stats,
// crests + streaks, radar profile, and per-match history. Every player
// name/avatar around the app links here.
export default function PlayerHub() {
  const { playerId = '' } = useParams();
  const { user } = useAuth();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [modalCode, setModalCode] = useState<string | null>(null);

  const isOwn = playerId === user?.userId;
  const year = searchParams.get('year') ? Number(searchParams.get('year')) : null;
  const rawType = searchParams.get('matchType');
  const matchType: MatchTypeFilter = rawType === '7-player' || rawType === 'futsal' ? rawType : 'all';

  const from = (location.state as { from?: string; fromLabel?: string } | null) ?? {};
  const backHref = from.from ?? '/statistics';
  const backLabel = from.fromLabel ?? 'Team stats';

  // Switching competitions changes the season calendar, so clear the picked
  // season and fall back to the latest — same rule as the statistics page.
  function setFilters(next: { year?: number | null; matchType?: MatchTypeFilter }) {
    const params = new URLSearchParams(searchParams);
    if ('matchType' in next) {
      if (next.matchType && next.matchType !== 'all') params.set('matchType', next.matchType);
      else params.delete('matchType');
      params.delete('year');
    }
    if ('year' in next) {
      if (next.year) params.set('year', String(next.year));
      else params.delete('year');
    }
    setSearchParams(params, { replace: true, state: location.state });
  }

  const { data, isLoading, error } = useQuery<PlayerStatsResponse>({
    queryKey: ['player-stats', playerId, year, matchType],
    queryFn: () => {
      const params = new URLSearchParams();
      if (year) params.set('year', String(year));
      if (matchType !== 'all') params.set('matchType', matchType);
      const qs = params.toString();
      return api.get(`/players/${playerId}/statistics${qs ? `?${qs}` : ''}`).then(r => r.data.data);
    },
    enabled: !!playerId,
    staleTime: 60_000,
  });

  const { data: achievements } = useQuery<PlayerAchievements>({
    queryKey: ['achievements', playerId],
    queryFn: () => api.get(`/players/${playerId}/achievements`).then(r => r.data.data),
    enabled: !!playerId && !error,
  });
  const { data: catalog } = useCatalog();

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [playerId]);

  const notFound = (error as { response?: { status?: number } } | null)?.response?.status === 404;

  const stats = data?.seasonStats;
  const player = data?.player;
  const played = stats?.total_played ?? 0;

  // Overall tier from earned crests — same aggregation as the team wall.
  const earned = achievements?.earned ?? null;
  const points = earned ? overallPoints(earned) : 0;
  const overallTier = earned ? overallRank(points).tier : null;

  // Radar profile — all axes normalized to 0-100.
  const radarData = stats ? [
    {
      metric: 'Attendance',
      value: Math.round(stats.attendance_rate),
      display: `${Math.round(stats.attendance_rate)}%`,
    },
    {
      metric: 'Goals/game',
      value: played > 0 ? Math.min(100, Math.round(stats.total_goals / played * 50)) : 0,
      display: played > 0 ? `${(stats.total_goals / played).toFixed(2)} per game` : '0 per game',
    },
    {
      metric: 'Assists/game',
      value: played > 0 ? Math.min(100, Math.round(stats.total_assists / played * 50)) : 0,
      display: played > 0 ? `${(stats.total_assists / played).toFixed(2)} per game` : '0 per game',
    },
    {
      // Share of the player's on-pitch half-slots spent in goal (2 halves per game).
      metric: 'Time in goal',
      value: played > 0 ? Math.min(100, Math.round(stats.gk_appearances / (played * 2) * 100)) : 0,
      display: played > 0 ? `${Math.min(100, Math.round(stats.gk_appearances / (played * 2) * 100))}% (${stats.gk_appearances} halves)` : '0%',
    },
  ] : [];

  // Per-match history (chronological, attended games only).
  const playerMatchData = (data?.recentMatches ?? [])
    .filter(m => m.attended)
    .reverse()
    .map(m => ({
      name: fmtDate(m.matchDate),
      Goals: m.goals ?? 0,
      Assists: m.assists ?? 0,
      'Clean sheets': m.cleanSheet ? 1 : 0,
    }));

  // Streaks — same wiring as the Achievements page's "mine" tab.
  const typeForCode: Record<string, StreakResult['type']> = {
    attendance_streak: 'attendance', scoring_streak: 'scoring', win_streak: 'win',
  };
  const groupByCode = new Map((achievements?.groups ?? []).map(g => [g.code, g]));
  const streakByType = new Map((achievements?.streaks ?? []).map(s => [s.type, s]));
  const streakEntries = (catalog?.individual ?? [])
    .filter(c => c.isStreak)
    .map(entry => ({ entry, streak: streakByType.get(typeForCode[entry.code]) }))
    .filter((x): x is { entry: NonNullable<typeof x.entry>; streak: StreakResult } => !!x.streak);

  return (
    <div className="min-h-screen bg-gray-50 boca-page">
      <AppNav backHref={backHref} backLabel={backLabel} />

      <main className="max-w-3xl mx-auto px-4 py-8 space-y-6">

        {notFound && (
          <div className="bg-white rounded-xl border border-gray-200 p-8 text-center space-y-3">
            <p className="text-gray-500 text-sm">Player not found.</p>
            <Link to="/statistics" className="inline-block text-sm font-medium text-brand-green hover:text-brand-green-700 transition-colors">
              ← Back to team stats
            </Link>
          </div>
        )}

        {!notFound && isLoading && (
          <div className="space-y-6">
            <Skeleton className="h-28 w-full rounded-xl" />
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="bg-white rounded-xl border border-gray-200 p-4 space-y-2">
                  <Skeleton className="h-7 w-12" />
                  <Skeleton className="h-3 w-16" />
                </div>
              ))}
            </div>
            <Skeleton className="h-52 w-full rounded-xl" />
          </div>
        )}

        {!notFound && !isLoading && data && player && stats && (
          <>
            {/* Header card — who it is, positions, tier, photo. */}
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex items-center gap-4">
                <Avatar src={player.avatarUrl} name={player.name} size={64} className="ring-1 ring-gray-200" />
                <div className="min-w-0 flex-1">
                  <h1 className="text-xl font-bold text-gray-900">
                    {player.name}
                    {isOwn && <span className="text-brand-green ml-2 text-sm font-medium">you</span>}
                  </h1>
                  <div className="flex gap-1.5 flex-wrap mt-2">
                    {(player.preferredPositions ?? []).length > 0
                      ? (player.preferredPositions ?? []).map(pos => (
                          <span key={pos} className={`text-xs font-medium px-2 py-0.5 rounded-full ${POS_COLOR[pos] ?? 'bg-gray-100 text-gray-500'}`}>{pos}</span>
                        ))
                      : <span className="text-sm text-gray-400">No positions set</span>}
                  </div>
                </div>
                {isOwn && (
                  <Link
                    to="/profile"
                    className="shrink-0 text-xs font-semibold text-brand-green border border-brand-green/40 hover:bg-brand-green/10 rounded-lg px-3 py-1.5 transition-colors"
                  >
                    Edit profile
                  </Link>
                )}
              </div>
              {earned && (
                <div className="mt-4 pt-4 border-t border-gray-100 flex items-center gap-3">
                  <Crest glyph="medal" tier={overallTier ?? 'bronze'} locked={!overallTier} size={44} showRibbon={false} />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs" style={{ color: overallTier ? TIER_META[overallTier].ribbon : '#9ca3af' }}>
                      {overallTier ? `${TIER_META[overallTier].label} rank` : 'Unranked'} · {earned.length} crest tiers
                    </p>
                    <div className="mt-1.5"><RankBar points={points} /></div>
                  </div>
                </div>
              )}
            </div>

            {/* Season + match-type filters */}
            <div className="flex items-center gap-2 flex-wrap">
              {data.availableSeasons.length > 0 && (
                <select
                  aria-label="Season"
                  value={year ?? stats.season_year}
                  onChange={e => setFilters({ year: Number(e.target.value) })}
                  className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green bg-white"
                >
                  {data.availableSeasons.map(s => (
                    <option key={s.year} value={s.year}>{s.label}</option>
                  ))}
                </select>
              )}
              <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm">
                {(['all', '7-player', 'futsal'] as const).map((type, i) => (
                  <button
                    key={type}
                    onClick={() => setFilters({ matchType: type })}
                    className={`px-3 py-1.5 transition-colors ${i > 0 ? 'border-l border-gray-200' : ''} ${
                      matchType === type
                        ? 'bg-brand-green text-white'
                        : 'bg-white text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    {type === 'all' ? 'All' : type === '7-player' ? '7-player' : 'Futsal'}
                  </button>
                ))}
              </div>
            </div>

            {/* Season stat cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {stats.total_signups !== null && <StatCard label="Signed up" value={stats.total_signups} />}
              <StatCard label="Games"        value={played} sub={stats.total_team_games > 0 ? `of ${stats.total_team_games} · ${Math.round(stats.attendance_rate)}%` : undefined} />
              <StatCard label="Goals"        value={stats.total_goals}        sub={played > 0 ? `${(stats.total_goals        / played).toFixed(2)}/game` : undefined} />
              <StatCard label="Assists"      value={stats.total_assists}      sub={played > 0 ? `${(stats.total_assists      / played).toFixed(2)}/game` : undefined} />
              <StatCard label="Clean sheets" value={stats.total_clean_sheets} sub={played > 0 ? `${(stats.total_clean_sheets / played).toFixed(2)}/game` : undefined} />
              <StatCard label="Avg rating"   value={stats.avg_rating > 0 ? stats.avg_rating.toFixed(1) : '—'} />
              {stats.total_man_of_match > 0 && <StatCard label="Man of match" value={stats.total_man_of_match} color="text-amber-500" />}
              {stats.total_yellow_cards > 0 && <StatCard label="Yellow cards" value={stats.total_yellow_cards} color="text-amber-500" />}
              {stats.total_red_cards > 0 && <StatCard label="Red cards" value={stats.total_red_cards} color="text-red-600" />}
            </div>

            {/* Crests — tap any to see the full description + tier ladder. */}
            <PlayerCrestStrip playerId={playerId} onOpen={setModalCode} linkToAchievements={isOwn} />

            {/* Streaks */}
            {streakEntries.length > 0 && (
              <section>
                <h2 className="text-sm font-semibold text-gray-700 mb-2">Streaks</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {streakEntries.map(({ entry, streak }) => (
                    <StreakCard
                      key={entry.code}
                      entry={entry}
                      streak={streak}
                      group={groupByCode.get(entry.code)}
                      onOpen={setModalCode}
                    />
                  ))}
                </div>
              </section>
            )}

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
                    <Radar name={player.name} dataKey="value" stroke={CHART_COLORS.goals} fill={CHART_COLORS.goals} fillOpacity={0.25} />
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
      </main>

      {modalCode && <BadgeDetailModal code={modalCode} onClose={() => setModalCode(null)} />}
    </div>
  );
}
