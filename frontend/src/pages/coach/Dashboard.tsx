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
  currentSignups: number;
  minPlayers: number;
  maxPlayers: number;
  signupDeadlinePassed: boolean;
}

const STATUS_STYLE: Record<string, string> = {
  draft:         'bg-gray-100 text-gray-600',
  signup_open:   'bg-green-100 text-green-700',
  signup_closed: 'bg-yellow-100 text-yellow-700',
  optimized:     'bg-blue-100 text-blue-700',
  published:     'bg-purple-100 text-purple-700',
  completed:     'bg-gray-100 text-gray-400',
};

const STATUS_LABEL: Record<string, string> = {
  draft:         'Draft',
  signup_open:   'Signup open',
  signup_closed: 'Signup closed',
  optimized:     'Optimized',
  published:     'Published',
  completed:     'Completed',
};

function MatchRow({ match }: { match: Match }) {
  const date = new Date(match.matchDate + 'T' + match.matchTime);
  const signupPct = Math.min(100, (match.currentSignups / match.maxPlayers) * 100);
  const low = match.currentSignups < match.minPlayers;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-start justify-between gap-4">
        {/* Date / location */}
        <div className="min-w-0">
          <p className="font-semibold text-gray-900">
            {date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
            {' '}—{' '}
            {match.matchTime.slice(0, 5)}
          </p>
          <p className="text-sm text-gray-500 mt-0.5 truncate">{match.location}</p>
        </div>

        {/* Status badge */}
        <span className={`shrink-0 text-xs font-medium px-2.5 py-1 rounded-full ${STATUS_STYLE[match.status] ?? 'bg-gray-100 text-gray-500'}`}>
          {STATUS_LABEL[match.status] ?? match.status}
        </span>
      </div>

      {/* Sign-up bar */}
      <div className="mt-4 space-y-1">
        <div className="flex justify-between text-xs text-gray-500">
          <span className={low ? 'text-red-500 font-medium' : ''}>
            {match.currentSignups} / {match.maxPlayers} signed up
            {low && <span> — need {match.minPlayers - match.currentSignups} more</span>}
          </span>
          <span>min {match.minPlayers}</span>
        </div>
        <div className="w-full bg-gray-100 rounded-full h-1.5">
          <div
            className={`h-1.5 rounded-full transition-all ${low ? 'bg-red-400' : 'bg-green-500'}`}
            style={{ width: `${signupPct}%` }}
          />
        </div>
      </div>

      {/* Actions */}
      <div className="mt-4 flex gap-2">
        <Link
          to={`/coach/matches/${match.matchId}`}
          className="text-sm text-brand-green hover:underline"
        >
          View signups
        </Link>
        {match.status === 'signup_closed' && (
          <span className="text-sm text-gray-400">· Ready to optimize</span>
        )}
      </div>
    </div>
  );
}

export default function CoachDashboard() {
  const { user, logout } = useAuth();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['matches', 'coach-all'],
    queryFn: () => api.get('/matches/upcoming?status=all').then(r => r.data.data),
  });

  const { data: pendingPerms } = useQuery<{ requestId: string; playerId: string; playerName: string; requestedAt: string }[]>({
    queryKey: ['result-permissions-pending'],
    queryFn: () => api.get('/result-permissions/pending').then(r => r.data.data),
    refetchInterval: 30_000,
  });

  const respondPerm = useMutation({
    mutationFn: ({ requestId, approve }: { requestId: string; approve: boolean }) =>
      api.put(`/result-permissions/${requestId}/respond`, { approve }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['result-permissions-pending'] }),
  });

  const matches: Match[] = data?.matches ?? [];
  const totalSignups = matches.reduce((s, m) => s + m.currentSignups, 0);
  const readyToOptimize = matches.filter(m => m.status === 'signup_closed').length;
  const publishedMatches = matches.filter(m => m.status === 'published' || m.status === 'completed');

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Nav */}
      <nav className="bg-brand-dark border-b border-brand-green/40 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <RavenIcon className="w-5 h-5 text-white" />
          <span className="font-bold text-white text-lg">
            Boca Schedule{' '}
            <span className="text-brand-green-300 text-sm font-normal">Coach</span>
          </span>
        </div>
        <div className="flex items-center gap-4">
          <Link to="/statistics" className="text-sm text-white/60 hover:text-white">Team Stats</Link>
          <Link to="/dashboard" className="text-sm text-white/60 hover:text-white">Player view</Link>
          {user?.role === 'admin' && (
            <Link to="/admin" className="text-sm text-purple-300 hover:text-purple-200">Admin panel</Link>
          )}
          <span className="text-sm text-white/70">{user?.name}</span>
          <button onClick={logout} className="text-sm text-white/60 hover:text-white/90">Logout</button>
        </div>
      </nav>

      <main className="max-w-2xl mx-auto px-4 py-8 space-y-8">

        {/* Permission requests */}
        {(pendingPerms ?? []).length > 0 && (
          <div className="bg-white rounded-xl border border-amber-200 p-5 space-y-3">
            <h2 className="font-semibold text-gray-900">
              Result entry requests
              <span className="ml-2 text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">{pendingPerms!.length}</span>
            </h2>
            {pendingPerms!.map(req => (
              <div key={req.requestId} className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-gray-900">{req.playerName}</p>
                  <p className="text-xs text-gray-400">Wants permission to record match results</p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => respondPerm.mutate({ requestId: req.requestId, approve: true })}
                    disabled={respondPerm.isPending}
                    className="text-xs bg-brand-green hover:bg-brand-green-700 disabled:opacity-50 text-white font-medium px-3 py-1.5 rounded-lg transition-colors"
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => respondPerm.mutate({ requestId: req.requestId, approve: false })}
                    disabled={respondPerm.isPending}
                    className="text-xs border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50 font-medium px-3 py-1.5 rounded-lg transition-colors"
                  >
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Matches</h1>
            {!isLoading && (
              <p className="text-sm text-gray-500 mt-1">
                {matches.length} upcoming · {totalSignups} total sign-ups
                {readyToOptimize > 0 && (
                  <span className="ml-2 text-yellow-600 font-medium">
                    · {readyToOptimize} ready to optimize
                  </span>
                )}
              </p>
            )}
          </div>
          <Link
            to="/coach/matches/new"
            className="bg-brand-green hover:bg-brand-green-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            + New match
          </Link>
        </div>

        {/* Result entry shortcuts for published/completed matches */}
        {publishedMatches.length > 0 && (
          <div className="space-y-2">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Record results</h2>
            {publishedMatches.map(m => {
              const d = new Date(m.matchDate + 'T' + m.matchTime);
              return (
                <Link
                  key={m.matchId}
                  to={`/matches/${m.matchId}/results`}
                  className="flex items-center justify-between bg-white rounded-xl border border-gray-200 px-5 py-3 hover:border-blue-300 transition-colors"
                >
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      {d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })} · {m.matchTime.slice(0, 5)}
                    </p>
                    <p className="text-xs text-gray-400">{m.location}</p>
                  </div>
                  <span className="text-xs text-brand-green font-medium">Enter result →</span>
                </Link>
              );
            })}
          </div>
        )}

        {/* Match list */}
        {isLoading && <p className="text-sm text-gray-400">Loading…</p>}
        {!isLoading && matches.length === 0 && (
          <p className="text-sm text-gray-400">No matches yet. Create one to get started.</p>
        )}
        <div className="space-y-4">
          {matches.map(m => <MatchRow key={m.matchId} match={m} />)}
        </div>
      </main>
    </div>
  );
}
