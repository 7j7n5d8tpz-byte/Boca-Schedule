import AppNav from '../../components/AppNav';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { formatLocation } from '../../components/LocationPicker';
import { meetingTime } from '../../utils';

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
  pendingSwap: { swapId: string; targetName: string; targetId: string } | null;
}

interface IncomingSwap {
  swapId: string;
  matchId: string;
  matchDate: string;
  matchTime: string;
  location: string;
  requesterName: string;
  requesterId: string;
  createdAt: string;
}

interface Player {
  userId: string;
  name: string;
  preferredPositions: string[];
}

// ─── Swap modal ───────────────────────────────────────────────────────────────

function SwapModal({
  matchId,
  onClose,
}: {
  matchId: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');

  const { data: players, isLoading } = useQuery<Player[]>({
    queryKey: ['all-players'],
    queryFn: () => api.get('/players').then(r => r.data.data),
  });

  const swapMutation = useMutation({
    mutationFn: (targetPlayerId: string) =>
      api.post(`/matches/${matchId}/swaps`, { targetPlayerId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['matches'] });
      onClose();
    },
    onError: (err: any) => setError(err.response?.data?.error?.message ?? 'Failed to request swap'),
  });

  const filtered = (players ?? []).filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">Choose a replacement</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">✕</button>
        </div>
        <p className="text-sm text-gray-500">Select a teammate to take your spot. They will need to accept.</p>

        <input
          type="text"
          placeholder="Search players…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green"
          autoFocus
        />

        <div className="max-h-56 overflow-y-auto space-y-1">
          {isLoading && <p className="text-sm text-gray-400 text-center py-4">Loading…</p>}
          {!isLoading && filtered.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-4">No players found</p>
          )}
          {filtered.map(p => (
            <button
              key={p.userId}
              onClick={() => { setError(''); swapMutation.mutate(p.userId); }}
              disabled={swapMutation.isPending}
              className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-brand-green-50 transition-colors disabled:opacity-50"
            >
              <p className="text-sm font-medium text-gray-900">{p.name}</p>
              <p className="text-xs text-gray-400">{p.preferredPositions.join(', ')}</p>
            </button>
          ))}
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}
      </div>
    </div>
  );
}

// ─── Match card ───────────────────────────────────────────────────────────────

function CantAttendDialog({
  match,
  onSwap,
  onClose,
}: {
  match: Match;
  onSwap: () => void;
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

        <div className="space-y-2">
          <button
            onClick={onSwap}
            className="w-full text-left px-4 py-3 rounded-xl border border-gray-200 hover:border-brand-green hover:bg-brand-green-50 transition-colors"
          >
            <p className="font-medium text-gray-900 text-sm">Find a replacement</p>
            <p className="text-xs text-gray-400 mt-0.5">Request a teammate to take your spot</p>
          </button>
          <button
            onClick={() => { setReleaseError(''); releaseMutation.mutate(); }}
            disabled={releaseMutation.isPending}
            className="w-full text-left px-4 py-3 rounded-xl border border-red-200 hover:bg-red-50 transition-colors disabled:opacity-50"
          >
            <p className="font-medium text-red-600 text-sm">{releaseMutation.isPending ? 'Releasing…' : 'Release my spot'}</p>
            <p className="text-xs text-gray-400 mt-0.5">No replacement — the coach will be notified</p>
          </button>
        </div>

        {releaseError && <p className="text-sm text-red-500">{releaseError}</p>}
      </div>
    </div>
  );
}

function MatchCard({ match }: { match: Match }) {
  const qc = useQueryClient();
  const [showSwapModal, setShowSwapModal] = useState(false);
  const [showCantAttend, setShowCantAttend] = useState(false);

  const signupMutation = useMutation({
    mutationFn: () => api.post('/signups', { matchId: match.matchId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['matches'] }),
  });

  const withdrawMutation = useMutation({
    mutationFn: () => api.delete(`/signups/${match.signupId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['matches'] }),
  });

  const cancelSwapMutation = useMutation({
    mutationFn: () => api.delete(`/swaps/${match.pendingSwap!.swapId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['matches'] }),
  });

  const deadline = new Date(match.signupCloseDate);
  const canWithdraw =
    match.userSignedUp &&
    !match.signupDeadlinePassed &&
    match.status !== 'published' &&
    match.status !== 'completed';

  return (
    <>
      {showSwapModal && (
        <SwapModal matchId={match.matchId} onClose={() => setShowSwapModal(false)} />
      )}
      {showCantAttend && (
        <CantAttendDialog
          match={match}
          onSwap={() => { setShowCantAttend(false); setShowSwapModal(true); }}
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
              {formatLocation(match.location, match.matchType)}
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

        {/* Pending outgoing swap notice */}
        {match.pendingSwap && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-center justify-between gap-3">
            <p className="text-xs text-amber-700">
              Swap request sent to <span className="font-medium">{match.pendingSwap.targetName}</span> — waiting for response
            </p>
            <button
              onClick={() => cancelSwapMutation.mutate()}
              disabled={cancelSwapMutation.isPending}
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

          {match.isSelected && match.status === 'published' && !match.pendingSwap && (
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

  const isCoachOrAdmin = user?.role === 'coach' || user?.role === 'admin';
  const canEnterResults = isCoachOrAdmin || myPermission?.canEnterResults;

  const { data: resultMatches } = useQuery<{ matchId: string; matchDate: string; matchTime: string; location: string; status: string; matchType: string; opponent: string | null }[]>({
    queryKey: ['result-matches'],
    queryFn: () => api.get('/matches/upcoming?status=published,completed').then(r => r.data.data.matches ?? []),
    enabled: !!canEnterResults,
  });

  const requestPermMutation = useMutation({
    mutationFn: () => api.post('/result-permissions/request'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['my-permission'] }),
  });

  const { data: incomingSwaps } = useQuery<IncomingSwap[]>({
    queryKey: ['swaps-incoming'],
    queryFn: () => api.get('/swaps/incoming').then(r => r.data.data),
    refetchInterval: 30_000,
  });

  const respondMutation = useMutation({
    mutationFn: ({ swapId, accept }: { swapId: string; accept: boolean }) =>
      api.put(`/swaps/${swapId}/respond`, { accept }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['swaps-incoming'] });
      qc.invalidateQueries({ queryKey: ['matches'] });
    },
  });

  const stats = statsData?.seasonStats;

  return (
    <div className="min-h-screen bg-gray-50 boca-page">
      <AppNav />

      <main className="max-w-2xl mx-auto px-4 py-8 space-y-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Welcome back, {user?.name?.split(' ')[0]}!</h1>
          <p className="text-gray-500 text-sm mt-1">Here's what's coming up.</p>
        </div>

        {/* Stats */}
        {stats && (() => {
          const played   = stats.total_played  ?? 0;
          const signups  = stats.total_signups ?? 0;
          const goals    = stats.total_goals     ?? 0;
          const assists  = stats.total_assists   ?? 0;
          const sheets   = stats.total_clean_sheets ?? 0;
          const attend   = stats.attendance_rate ?? 0;

          return (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: 'Played',        value: played },
                  { label: 'Goals',         value: goals },
                  { label: 'Assists',       value: assists },
                  { label: 'Signed up',     value: signups },
                  { label: 'Clean sheets',  value: sheets },
                  { label: 'Attendance',    value: `${Math.round(attend)}%` },
                ].map(s => (
                  <div key={s.label} className="bg-white rounded-xl border border-gray-200 p-4 text-center">
                    <p className="text-2xl font-bold text-gray-900">{s.value}</p>
                    <p className="text-xs text-gray-500 mt-1">{s.label}</p>
                  </div>
                ))}
              </div>

              {/* Quick links */}
              <div className="grid grid-cols-2 gap-3">
                <Link to="/statistics" className="bg-white rounded-xl border border-gray-200 hover:border-brand-green p-4 flex items-center justify-between gap-3 transition-colors group">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">Team Stats</p>
                    <p className="text-xs text-gray-400 mt-0.5">Leaderboards &amp; match highlights</p>
                  </div>
                  <span className="text-gray-300 group-hover:text-brand-green transition-colors text-lg">→</span>
                </Link>
                <Link to="/profile" className="bg-white rounded-xl border border-gray-200 hover:border-brand-green p-4 flex items-center justify-between gap-3 transition-colors group">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">My Profile</p>
                    <p className="text-xs text-gray-400 mt-0.5">Positions &amp; account info</p>
                  </div>
                  <span className="text-gray-300 group-hover:text-brand-green transition-colors text-lg">→</span>
                </Link>
              </div>
            </div>
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
          const pending  = (resultMatches ?? []).filter(m => m.status === 'published');
          const recorded = (resultMatches ?? []).filter(m => m.status === 'completed');
          if (!resultMatches || (!pending.length && !recorded.length)) return null;
          return (
            <ResultMatchesList pending={pending} recorded={recorded} />
          );
        })()}

        {/* Incoming swap requests */}
        {(incomingSwaps ?? []).length > 0 && (
          <div className="space-y-3">
            <h2 className="text-lg font-semibold text-gray-900">Swap Requests</h2>
            {incomingSwaps!.map(swap => {
              const date = new Date(`${swap.matchDate}T${swap.matchTime}`);
              return (
                <div key={swap.swapId} className="bg-white rounded-xl border border-orange-200 p-4 space-y-3">
                  <div>
                    <p className="font-medium text-gray-900">
                      <span className="text-orange-600">{swap.requesterName}</span> can't attend
                    </p>
                    <p className="text-sm text-gray-500 mt-0.5">
                      {date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })} — {swap.matchTime.slice(0, 5)} · {swap.location}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      They're asking if you can cover their spot
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => respondMutation.mutate({ swapId: swap.swapId, accept: true })}
                      disabled={respondMutation.isPending}
                      className="flex-1 bg-brand-green hover:bg-brand-green-700 disabled:opacity-50 text-white text-sm font-medium py-2 rounded-lg transition-colors"
                    >
                      Accept
                    </button>
                    <button
                      onClick={() => respondMutation.mutate({ swapId: swap.swapId, accept: false })}
                      disabled={respondMutation.isPending}
                      className="flex-1 border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50 text-sm font-medium py-2 rounded-lg transition-colors"
                    >
                      Decline
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Upcoming matches */}
        <div>
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Upcoming Matches</h2>
          {isLoading && <p className="text-sm text-gray-400">Loading...</p>}
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
