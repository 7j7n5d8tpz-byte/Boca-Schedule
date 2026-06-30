import AppNav from '../../components/AppNav';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { formatLocation } from '../../components/LocationPicker';
import { meetingTime, mapsUrl, buildMatchIcs, downloadIcs } from '../../utils';
import { CardListSkeleton } from '../../components/Skeleton';
import Icon from '../../components/Icon';
import CountUp from '../../components/CountUp';
import Crest, { tierRank } from '../../components/Crest';
import CrestUnlock from '../../components/CrestUnlock';
import { useCatalog, type PlayerAchievements } from '../../api/achievements';

interface Match {
  matchId: string;
  matchDate: string;
  matchTime: string;
  location: string;
  opponent: string | null;
  matchType: string;
  status: string;
  signupCloseDate: string;
  minPlayers: number;
  maxPlayers: number;
  currentSignups: number;
  userSignedUp: boolean;
  signupId: string | null;
  signupDeadlinePassed: boolean;
  isSelected: boolean;
  openSpot: boolean;
  myClaim: { claimId: string; status: string } | null;
}

interface Player {
  userId: string;
  name: string;
  preferredPositions: string[];
}

interface Announcement {
  announcementId: string;
  body: string;
  createdAt: string;
  author: string;
  match: { matchId: string; matchDate: string; opponent: string | null } | null;
}

const POS_COLOR: Record<string, string> = {
  GK:  'bg-yellow-100 text-yellow-700',
  DEF: 'bg-blue-100 text-blue-700',
  WIN: 'bg-green-100 text-green-700',
  MID: 'bg-purple-100 text-purple-700',
  STR: 'bg-red-100 text-red-700',
};

// ─── Match card ───────────────────────────────────────────────────────────────

function CantAttendDialog({
  match,
  onClose,
}: {
  match: Match;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [releaseError, setReleaseError] = useState('');

  const releaseMutation = useMutation({
    mutationFn: () => api.post(`/matches/${match.matchId}/release`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['matches'] }); onClose(); },
    onError: (err: any) => setReleaseError(err.response?.data?.error?.message ?? 'Failed to release spot'),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">Can't attend?</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">✕</button>
        </div>
        <p className="text-sm text-gray-500">
          {new Date(match.matchDate).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
          {' — '}{match.matchTime.slice(0, 5)}
        </p>

        <p className="text-sm text-gray-500">
          Release your spot and the coach plus any available teammates will be notified, so someone can claim it.
        </p>

        <div className="space-y-2">
          <button
            onClick={() => { setReleaseError(''); releaseMutation.mutate(); }}
            disabled={releaseMutation.isPending}
            className="w-full text-left px-4 py-3 rounded-xl border border-red-200 hover:bg-red-50 transition-colors disabled:opacity-50"
          >
            <p className="font-medium text-red-600 text-sm">{releaseMutation.isPending ? 'Releasing…' : 'Release my spot'}</p>
            <p className="text-xs text-gray-400 mt-0.5">The coach and available teammates will be notified</p>
          </button>
        </div>

        {releaseError && <p className="text-sm text-red-500">{releaseError}</p>}
      </div>
    </div>
  );
}

function MatchCard({ match }: { match: Match }) {
  const qc = useQueryClient();
  const [showCantAttend, setShowCantAttend] = useState(false);
  const [showSquad, setShowSquad] = useState(false);
  const [claimError, setClaimError] = useState('');

  const { data: squad } = useQuery<{ selected: Player[]; guests: { name: string; position: string | null }[]; count: number }>({
    queryKey: ['squad', match.matchId],
    queryFn: () => api.get(`/matches/${match.matchId}/squad`).then(r => r.data.data),
    enabled: showSquad && match.status === 'published',
  });

  const signupMutation = useMutation({
    mutationFn: () => api.post('/signups', { matchId: match.matchId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['matches'] }),
  });

  const withdrawMutation = useMutation({
    mutationFn: () => api.delete(`/signups/${match.signupId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['matches'] }),
  });

  const claimMutation = useMutation({
    mutationFn: () => api.post(`/matches/${match.matchId}/claims`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['matches'] }),
    onError: (err: any) => setClaimError(err.response?.data?.error?.message ?? 'Failed to claim spot'),
  });

  const cancelClaimMutation = useMutation({
    mutationFn: () => api.delete(`/claims/${match.myClaim!.claimId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['matches'] }),
  });

  function addToCalendar() {
    const ics = buildMatchIcs({
      matchId: match.matchId, matchDate: match.matchDate, matchTime: match.matchTime,
      location: match.location, opponent: match.opponent,
    });
    const dateLabel = new Date(match.matchDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }).replace(' ', '-');
    downloadIcs(`boca-${dateLabel}.ics`, ics);
  }

  const deadline = new Date(match.signupCloseDate);
  const canWithdraw =
    match.userSignedUp &&
    !match.signupDeadlinePassed &&
    match.status !== 'published' &&
    match.status !== 'completed';

  return (
    <>
      {showCantAttend && (
        <CantAttendDialog
          match={match}
          onClose={() => setShowCantAttend(false)}
        />
      )}

      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
        <div className="flex items-start justify-between">
          <div>
            <p className="font-semibold text-gray-900">
              {new Date(match.matchDate).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
              {match.opponent && <span className="text-gray-500 font-normal"> · vs {match.opponent}</span>}
            </p>
            <p className="text-sm text-gray-700">
              {match.matchTime.slice(0, 5)} (meet at {meetingTime(match.matchTime)})
            </p>
            <p className="text-sm text-gray-500">
              <a
                href={mapsUrl(match.location)}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-brand-green hover:underline"
                title="Open in Maps"
              >
                {formatLocation(match.location, match.matchType)}
              </a>
              <span className={`ml-2 text-xs font-medium px-1.5 py-0.5 rounded ${match.matchType === 'futsal' ? 'bg-orange-100 text-orange-700' : 'bg-gray-100 text-gray-500'}`}>
                {match.matchType}
              </span>
            </p>
          </div>
          <div className="flex flex-col items-end gap-1">
            {match.userSignedUp && match.status === 'published' && match.isSelected && (
              <span className="bg-green-100 text-green-700 text-xs font-medium px-2.5 py-1 rounded-full">Selected ✓</span>
            )}
            {match.userSignedUp && match.status === 'published' && !match.isSelected && (
              <span className="bg-gray-100 text-gray-500 text-xs font-medium px-2.5 py-1 rounded-full">Not selected</span>
            )}
            {match.userSignedUp && match.status !== 'published' && match.status !== 'completed' && (
              <span className="bg-blue-100 text-blue-700 text-xs font-medium px-2.5 py-1 rounded-full">Signed up</span>
            )}
          </div>
        </div>

        <div className="flex gap-4 text-sm text-gray-600">
          <span>Players: {match.currentSignups}/{match.maxPlayers}</span>
          <span>Deadline: {deadline.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
        </div>

        <div className="w-full bg-gray-100 rounded-full h-1.5">
          <div
            className="bg-brand-green h-1.5 rounded-full transition-all"
            style={{ width: `${Math.min(100, (match.currentSignups / match.maxPlayers) * 100)}%` }}
          />
        </div>

        {/* Open spot available — claimable by players not in the squad */}
        {match.status === 'published' && !match.isSelected && match.openSpot && !match.myClaim && (
          <div className="bg-brand-green-50 border border-brand-green/30 rounded-lg px-3 py-2 flex items-center justify-between gap-3">
            <p className="text-xs text-gray-700 flex items-center gap-1.5">
              <Icon name="tag" className="w-4 h-4 text-brand-green shrink-0" /> A spot is open — claim it and the coach will confirm.
            </p>
            <button
              onClick={() => { setClaimError(''); claimMutation.mutate(); }}
              disabled={claimMutation.isPending}
              className="text-xs bg-brand-green hover:bg-brand-green-700 text-white font-medium px-3 py-1.5 rounded-lg shrink-0 disabled:opacity-50 transition-colors"
            >
              {claimMutation.isPending ? 'Claiming…' : 'Claim spot'}
            </button>
          </div>
        )}
        {claimError && <p className="text-xs text-red-500">{claimError}</p>}

        {/* Pending claim notice */}
        {match.myClaim && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-center justify-between gap-3">
            <p className="text-xs text-amber-700">
              Spot claimed — waiting for the coach to confirm
            </p>
            <button
              onClick={() => cancelClaimMutation.mutate()}
              disabled={cancelClaimMutation.isPending}
              className="text-xs text-amber-600 hover:text-amber-800 font-medium shrink-0 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 pt-1">
          {!match.userSignedUp && !match.signupDeadlinePassed && match.status === 'signup_open' && (
            <button
              onClick={() => signupMutation.mutate()}
              disabled={signupMutation.isPending}
              className="flex-1 bg-brand-green hover:bg-brand-green-700 disabled:opacity-50 text-white text-sm font-medium py-2 rounded-lg transition-colors"
            >
              {signupMutation.isPending ? 'Signing up…' : 'Sign Up'}
            </button>
          )}

          {canWithdraw && (
            <button
              onClick={() => withdrawMutation.mutate()}
              disabled={withdrawMutation.isPending}
              className="flex-1 border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50 text-sm font-medium py-2 rounded-lg transition-colors"
            >
              {withdrawMutation.isPending ? 'Withdrawing…' : 'Withdraw'}
            </button>
          )}

          {match.isSelected && match.status === 'published' && (
            <button
              onClick={() => setShowCantAttend(true)}
              className="flex-1 border border-orange-300 text-orange-600 hover:bg-orange-50 text-sm font-medium py-2 rounded-lg transition-colors"
            >
              Can't attend
            </button>
          )}

          {match.signupDeadlinePassed && !match.userSignedUp && match.status !== 'published' && (
            <p className="text-xs text-gray-400 text-center w-full py-1">Signup closed</p>
          )}
        </div>

        {/* Footer: calendar + squad */}
        {(match.userSignedUp || match.isSelected || match.status === 'published') && (
          <div className="pt-1 border-t border-gray-100 flex items-center gap-4 mt-2">
            {(match.userSignedUp || match.isSelected) && (
              <button
                onClick={addToCalendar}
                className="text-xs text-gray-400 hover:text-brand-green transition-colors inline-flex items-center gap-1.5"
              >
                <Icon name="calendar" className="w-3.5 h-3.5" /> Add to calendar
              </button>
            )}
            {match.status === 'published' && (
              <button
                onClick={() => setShowSquad(v => !v)}
                className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
              >
                {showSquad ? 'Hide squad' : `View squad${squad ? ` (${squad.count})` : ''}`}
              </button>
            )}
          </div>
        )}

        {/* Confirmed squad (published matches) */}
        {match.status === 'published' && showSquad && (
          <div>
            {squad && (
              <div className="mt-2 space-y-1.5">
                {squad.selected.map(p => (
                  <div key={p.userId} className="flex items-center gap-2 text-sm">
                    <span className="text-gray-700 flex-1 truncate">{p.name}</span>
                    <span className="flex gap-1 shrink-0">
                      {p.preferredPositions.map(pos => (
                        <span key={pos} className={`text-xs font-medium px-1.5 py-0.5 rounded ${POS_COLOR[pos] ?? 'bg-gray-100 text-gray-500'}`}>{pos}</span>
                      ))}
                    </span>
                  </div>
                ))}
                {squad.guests.map((g, i) => (
                  <div key={`g${i}`} className="flex items-center gap-2 text-sm">
                    <span className="text-gray-700 flex-1 truncate">{g.name}</span>
                    <span className="flex gap-1 shrink-0">
                      <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">guest{g.position ? ` · ${g.position}` : ''}</span>
                    </span>
                  </div>
                ))}
                {squad.count === 0 && <p className="text-xs text-gray-400">No players selected.</p>}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}

// ─── Record results section ───────────────────────────────────────────────────

function ResultMatchesList({
  pending,
  recorded,
}: {
  pending: { matchId: string; matchDate: string; matchTime: string; location: string; opponent: string | null }[];
  recorded: { matchId: string; matchDate: string; matchTime: string; location: string; opponent: string | null }[];
}) {
  const [showRecorded, setShowRecorded] = useState(false);

  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold text-gray-900">Record results</h2>
      {pending.length === 0 && (
        <p className="text-sm text-gray-400">All results recorded.</p>
      )}
      {pending.map(m => (
        <Link
          key={m.matchId}
          to={`/matches/${m.matchId}/results`}
          className="flex items-center justify-between bg-white rounded-xl border border-gray-200 hover:border-brand-green px-5 py-3 transition-colors"
        >
          <div>
            <p className="text-sm font-medium text-gray-900">
              {new Date(m.matchDate).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
              {' · '}{m.matchTime.slice(0, 5)}
              {m.opponent && <span className="text-gray-400 font-normal"> vs {m.opponent}</span>}
            </p>
            <p className="text-xs text-gray-400">{m.location}</p>
          </div>
          <span className="text-xs font-medium text-brand-green shrink-0">Enter result →</span>
        </Link>
      ))}
      {recorded.length > 0 && (
        <>
          <button
            onClick={() => setShowRecorded(v => !v)}
            className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
          >
            {showRecorded ? 'Hide recorded matches' : `+ ${recorded.length} already recorded`}
          </button>
          {showRecorded && recorded.map(m => (
            <Link
              key={m.matchId}
              to={`/matches/${m.matchId}/results`}
              className="flex items-center justify-between bg-white rounded-xl border border-gray-100 opacity-60 hover:opacity-90 px-5 py-3 transition-opacity"
            >
              <div>
                <p className="text-sm font-medium text-gray-900">
                  {new Date(m.matchDate).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
                  {' · '}{m.matchTime.slice(0, 5)}
                  {m.opponent && <span className="text-gray-400 font-normal"> vs {m.opponent}</span>}
                </p>
                <p className="text-xs text-gray-400">{m.location}</p>
              </div>
              <span className="text-xs font-medium text-gray-400 shrink-0">Edit result →</span>
            </Link>
          ))}
        </>
      )}
    </div>
  );
}

// ─── Main dashboard ───────────────────────────────────────────────────────────

export default function PlayerDashboard() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['matches'],
    queryFn: () => api.get('/matches/upcoming').then(r => r.data.data),
  });

  const { data: announcements } = useQuery<Announcement[]>({
    queryKey: ['announcements'],
    queryFn: () => api.get('/announcements').then(r => r.data.data),
  });

  const { data: statsData } = useQuery({
    queryKey: ['stats', user?.userId],
    queryFn: () => api.get(`/players/${user!.userId}/statistics`).then(r => r.data.data),
    enabled: !!user,
  });

  const { data: myPermission } = useQuery({
    queryKey: ['my-permission'],
    queryFn: () => api.get('/result-permissions/my').then(r => r.data.data),
    enabled: !!user,
  });

  const { data: finesSummary } = useQuery<{ totals: { outstandingDkk: number; claimedDkk: number; paidDkk: number } }>({
    queryKey: ['fines-summary'],
    queryFn: () => api.get('/fines/my').then(r => r.data.data),
    enabled: !!user,
  });

  const { data: achievements } = useQuery<PlayerAchievements>({
    queryKey: ['achievements', user?.userId],
    queryFn: () => api.get(`/players/${user!.userId}/achievements`).then(r => r.data.data),
    enabled: !!user,
  });
  const { data: achCatalog } = useCatalog(); // also warms the cache for the unlock modal
  const glyphFor = (code: string) =>
    achCatalog?.individual.find(c => c.code === code)?.glyph ?? 'medal';

  const isCoachOrAdmin = user?.role === 'coach' || user?.role === 'admin';
  const canEnterResults = isCoachOrAdmin || myPermission?.canEnterResults;

  const { data: resultMatches } = useQuery<{ matchId: string; matchDate: string; matchTime: string; location: string; status: string; matchType: string; opponent: string | null; hasResult: boolean }[]>({
    queryKey: ['result-matches'],
    queryFn: () => api.get('/matches/upcoming?status=published,completed').then(r => r.data.data.matches ?? []),
    enabled: !!canEnterResults,
  });

  const requestPermMutation = useMutation({
    mutationFn: () => api.post('/result-permissions/request'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['my-permission'] }),
  });

  const stats = statsData?.seasonStats;

  return (
    <div className="min-h-screen bg-gray-50 boca-page">
      <AppNav />
      {user && achievements && <CrestUnlock userId={user.userId} earned={achievements.earned} />}

      <main className="max-w-2xl mx-auto px-4 py-8 space-y-8">
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900">Welcome back, {user?.name?.split(' ')[0]}!</h1>
          <p className="text-gray-500 text-sm mt-1">Here's what's coming up.</p>
        </div>

        {/* Announcements */}
        {(announcements ?? []).length > 0 && (
          <div className="space-y-2">
            {announcements!.map(a => (
              <div key={a.announcementId} className="bg-brand-green-50 border border-brand-green/30 rounded-xl px-4 py-3">
                <p className="text-sm text-gray-800 whitespace-pre-wrap flex gap-1.5"><Icon name="megaphone" className="w-4 h-4 text-brand-green shrink-0 mt-0.5" /> <span>{a.body}</span></p>
                <p className="text-xs text-gray-400 mt-1">
                  {a.author}
                  {a.match && ` · for ${new Date(a.match.matchDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}${a.match.opponent ? ` vs ${a.match.opponent}` : ''}`}
                </p>
              </div>
            ))}
          </div>
        )}

        {/* Stats */}
        {stats && (() => {
          const played   = stats.total_played  ?? 0;
          const teamGames = stats.total_team_games ?? 0;
          const signups  = stats.total_signups ?? 0;
          const goals    = stats.total_goals     ?? 0;
          const assists  = stats.total_assists   ?? 0;
          const sheets   = stats.total_clean_sheets ?? 0;
          const attend   = stats.attendance_rate ?? 0;
          const season   = stats.season_year;

          return (
            <div className="space-y-4">
              {season && (
                <div className="flex items-baseline justify-between">
                  <h2 className="text-sm font-semibold text-gray-700">Your season</h2>
                  <span className="text-xs text-gray-400">{season}</span>
                </div>
              )}
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: 'Played',        value: played, suffix: ` / ${teamGames}` },
                  { label: 'Goals',         value: goals },
                  { label: 'Assists',       value: assists },
                  { label: 'Signed up',     value: signups },
                  { label: 'Clean sheets',  value: sheets },
                  { label: 'Attendance',    value: Math.round(attend), suffix: '%' },
                ].map(s => (
                  <div key={s.label} className="bg-white rounded-xl border border-gray-200 p-4 text-center">
                    <p className="text-2xl font-bold font-numeric text-gray-900"><CountUp value={s.value} />{s.suffix ?? ''}</p>
                    <p className="text-xs text-gray-500 mt-1">{s.label}</p>
                  </div>
                ))}
              </div>

              {/* Quick links */}
              <div className="grid grid-cols-2 gap-3">
                <Link to="/statistics" className="bg-white rounded-xl border border-gray-200 hover:border-brand-green p-4 flex items-center justify-between gap-3 transition-colors group lift">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">Team Stats</p>
                    <p className="text-xs text-gray-400 mt-0.5">Leaderboards &amp; match highlights</p>
                  </div>
                  <span className="text-gray-300 group-hover:text-brand-green transition-colors text-lg">→</span>
                </Link>
                <Link to="/profile" className="bg-white rounded-xl border border-gray-200 hover:border-brand-green p-4 flex items-center justify-between gap-3 transition-colors group lift">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">My Profile</p>
                    <p className="text-xs text-gray-400 mt-0.5">Positions &amp; account info</p>
                  </div>
                  <span className="text-gray-300 group-hover:text-brand-green transition-colors text-lg">→</span>
                </Link>
                <Link to="/achievements" className="col-span-2 bg-white rounded-xl border border-gray-200 hover:border-brand-green p-4 flex items-center justify-between gap-3 transition-colors group lift">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900">Achievements</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {achievements && achievements.earned.length > 0
                        ? `${achievements.earned.length} crest tier${achievements.earned.length > 1 ? 's' : ''} earned`
                        : 'Earn crests, climb the tiers'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {achievements && [...achievements.earned]
                      .sort((a, b) => tierRank(b.tier) - tierRank(a.tier))
                      .slice(0, 3)
                      .map(e => (
                        <Crest key={`${e.code}:${e.tier}`} glyph={glyphFor(e.code)} tier={e.tier} size={34} showRibbon={false} />
                      ))}
                    <span className="text-gray-300 group-hover:text-brand-green transition-colors text-lg">→</span>
                  </div>
                </Link>
              </div>
            </div>
          );
        })()}

        {/* Fines */}
        {finesSummary && (() => {
          const t = finesSummary.totals;
          const due = t.outstandingDkk;
          const awaiting = t.claimedDkk;
          return (
            <Link
              to="/fines"
              className={`block rounded-xl border p-4 flex items-center justify-between gap-3 transition-colors group lift ${
                due > 0 ? 'bg-amber-50 border-amber-300 hover:border-amber-400' : 'bg-white border-gray-200 hover:border-brand-green'
              }`}
            >
              <div>
                <p className="text-sm font-semibold text-gray-900">My Fines</p>
                <p className="text-xs mt-0.5 text-gray-500">
                  {due > 0
                    ? <span className="text-amber-700 font-medium">{due.toLocaleString('da-DK')} kr outstanding — tap to pay</span>
                    : awaiting > 0
                      ? <span className="text-blue-600">{awaiting.toLocaleString('da-DK')} kr awaiting confirmation</span>
                      : 'All settled — nice'}
                </p>
              </div>
              <span className="text-gray-300 group-hover:text-brand-green transition-colors text-lg">→</span>
            </Link>
          );
        })()}

        {/* Result entry permission */}
        {myPermission && !myPermission.canEnterResults && (
          <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-gray-900">Record match results</p>
              <p className="text-xs text-gray-400 mt-0.5">
                {myPermission.pendingRequest
                  ? 'Your request is pending coach approval'
                  : 'Request permission to enter goals, assists and saves after matches'}
              </p>
            </div>
            {!myPermission.pendingRequest && (
              <button
                onClick={() => requestPermMutation.mutate()}
                disabled={requestPermMutation.isPending}
                className="shrink-0 text-xs bg-brand-green hover:bg-brand-green-700 disabled:opacity-50 text-white font-medium px-3 py-1.5 rounded-lg transition-colors"
              >
                {requestPermMutation.isPending ? 'Requesting…' : 'Request access'}
              </button>
            )}
            {myPermission.pendingRequest && (
              <span className="shrink-0 text-xs text-amber-600 font-medium">Pending</span>
            )}
          </div>
        )}
        {canEnterResults && (() => {
          const pending  = (resultMatches ?? []).filter(m => !m.hasResult);
          const recorded = (resultMatches ?? []).filter(m =>  m.hasResult);
          if (!resultMatches || (!pending.length && !recorded.length)) return null;
          return (
            <ResultMatchesList pending={pending} recorded={recorded} />
          );
        })()}

        {/* Upcoming matches */}
        <div>
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Upcoming Matches</h2>
          {isLoading && <CardListSkeleton />}
          {!isLoading && !data?.matches?.length && (
            <p className="text-sm text-gray-400">No open matches right now.</p>
          )}
          <div className="space-y-4">
            {(data?.matches ?? []).map((m: Match) => <MatchCard key={m.matchId} match={m} />)}
          </div>
        </div>
      </main>
    </div>
  );
}
