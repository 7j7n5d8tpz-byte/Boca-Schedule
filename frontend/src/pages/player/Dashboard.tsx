import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import RavenIcon from '../../components/RavenIcon';

interface Match {
  matchId: string;
  matchDate: string;
  matchTime: string;
  location: string;
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

function MatchCard({ match }: { match: Match }) {
  const qc = useQueryClient();
  const [showSwapModal, setShowSwapModal] = useState(false);

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

      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
        <div className="flex items-start justify-between">
          <div>
            <p className="font-semibold text-gray-900">
              {new Date(match.matchDate).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })} &mdash; {match.matchTime.slice(0, 5)}
            </p>
            <p className="text-sm text-gray-500">{match.location} <span className="capitalize">({match.matchType})</span></p>
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
              onClick={() => setShowSwapModal(true)}
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

// ─── Main dashboard ───────────────────────────────────────────────────────────

export default function PlayerDashboard() {
  const { user, logout } = useAuth();
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
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-brand-dark border-b border-brand-green/40 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <RavenIcon className="w-5 h-5 text-white" />
          <span className="font-bold text-white text-lg">Boca Schedule</span>
        </div>
        <div className="flex items-center gap-4">
          <Link to="/statistics" className="text-sm text-white/60 hover:text-white">Team Stats</Link>
          {(user?.role === 'coach' || user?.role === 'admin') && (
            <Link to="/coach" className="text-sm text-white/60 hover:text-white">Coach view</Link>
          )}
          {user?.role === 'admin' && (
            <Link to="/admin" className="text-sm text-purple-300 hover:text-purple-200">Admin panel</Link>
          )}
          <Link to="/profile" className="text-sm text-white/70 hover:text-white">{user?.name}</Link>
          <button onClick={logout} className="text-sm text-white/60 hover:text-white/90">Logout</button>
        </div>
      </nav>

      <main className="max-w-2xl mx-auto px-4 py-8 space-y-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Welcome back, {user?.name?.split(' ')[0]}!</h1>
          <p className="text-gray-500 text-sm mt-1">Here's what's coming up.</p>
        </div>

        {/* Quick stats */}
        {stats && (
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: 'Matches Played', value: stats.totalPlayed ?? 0 },
              { label: 'Selected', value: stats.totalSelected ?? 0 },
              { label: 'Attendance', value: `${stats.attendanceRate ?? 0}%` },
            ].map(s => (
              <div key={s.label} className="bg-white rounded-xl border border-gray-200 p-4 text-center">
                <p className="text-2xl font-bold text-gray-900">{s.value}</p>
                <p className="text-xs text-gray-500 mt-1">{s.label}</p>
              </div>
            ))}
          </div>
        )}

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
        {myPermission?.canEnterResults && (
          <div className="bg-green-50 border border-green-200 rounded-xl p-4">
            <p className="text-sm font-medium text-green-700">You can record match results</p>
            <p className="text-xs text-green-600 mt-0.5">Visit <Link to="/statistics" className="underline">Team Stats</Link> to enter results for published matches.</p>
          </div>
        )}

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
