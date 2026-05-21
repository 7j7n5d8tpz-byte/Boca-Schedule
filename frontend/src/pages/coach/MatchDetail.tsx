import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';

interface SignupPlayer {
  signupId: string;
  player: { userId: string; name: string; preferredPositions: string[] };
  isPriority: boolean;
  signedUpAt: string;
}

interface MatchData {
  matchId: string;
  matchDate: string;
  matchTime: string;
  minPlayers: number;
  maxPlayers: number;
}

interface SignupsResponse {
  match: MatchData;
  signups: SignupPlayer[];
  summary: { totalSignups: number; prioritySignups: number };
}

const POS_COLOR: Record<string, string> = {
  GK:  'bg-yellow-100 text-yellow-700',
  DEF: 'bg-blue-100 text-blue-700',
  WIN: 'bg-green-100 text-green-700',
  MID: 'bg-purple-100 text-purple-700',
  STR: 'bg-red-100 text-red-700',
};

export default function MatchDetail() {
  const { matchId } = useParams<{ matchId: string }>();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();

  // local optimistic priority state: signupId → isPriority
  const [priorityMap, setPriorityMap] = useState<Record<string, boolean>>({});
  const [optimizeError, setOptimizeError] = useState('');

  const { data, isLoading } = useQuery<SignupsResponse>({
    queryKey: ['match-signups', matchId],
    queryFn: () => api.get(`/matches/${matchId}/signups`).then(r => r.data.data),
    onSuccess: (d: SignupsResponse) => {
      const initial: Record<string, boolean> = {};
      d.signups.forEach(s => { initial[s.signupId] = s.isPriority; });
      setPriorityMap(initial);
    },
  } as any);

  const priorityMutation = useMutation({
    mutationFn: ({ signupId, value }: { signupId: string; value: boolean }) =>
      api.put(`/signups/${signupId}/priority`, { isPriority: value }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['match-signups', matchId] }),
  });

  const optimizeMutation = useMutation({
    mutationFn: () => api.post(`/matches/${matchId}/optimize`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['matches'] });
      navigate(`/coach/matches/${matchId}/selections`);
    },
    onError: (err: any) => {
      setOptimizeError(err.response?.data?.error?.message ?? 'Optimization failed');
    },
  });

  function togglePriority(signupId: string) {
    const next = !(priorityMap[signupId] ?? false);
    setPriorityMap(m => ({ ...m, [signupId]: next }));
    priorityMutation.mutate({ signupId, value: next });
  }

  if (isLoading) {
    return <div className="min-h-screen bg-gray-50 flex items-center justify-center text-gray-400">Loading…</div>;
  }

  if (!data) {
    return <div className="min-h-screen bg-gray-50 flex items-center justify-center text-red-500">Match not found</div>;
  }

  const { match, signups, summary } = data;
  const date = new Date(`${match.matchDate}T${match.matchTime}`);

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link to="/coach" className="text-gray-400 hover:text-gray-600 text-sm">← Matches</Link>
          <span className="text-gray-300">|</span>
          <span className="font-bold text-gray-900 text-lg">
            Boca Schedule <span className="text-blue-600 text-sm font-normal">Coach</span>
          </span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-600">{user?.name}</span>
          <button onClick={logout} className="text-sm text-gray-500 hover:text-gray-700">Logout</button>
        </div>
      </nav>

      <main className="max-w-2xl mx-auto px-4 py-8 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
          </h1>
          <p className="text-gray-500 mt-1">
            {match.matchTime.slice(0, 5)} · {summary.totalSignups} signed up
            {summary.prioritySignups > 0 && (
              <span className="ml-2 text-amber-600 font-medium">· {summary.prioritySignups} priority</span>
            )}
          </p>
        </div>

        {/* Optimize card */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="font-semibold text-gray-900">Run optimizer</p>
              <p className="text-sm text-gray-500 mt-0.5">
                Selects the best {match.minPlayers}–{match.maxPlayers} players based on fairness and formation fit.
              </p>
            </div>
            <button
              onClick={() => { setOptimizeError(''); optimizeMutation.mutate(); }}
              disabled={optimizeMutation.isPending || signups.length === 0}
              className="shrink-0 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              {optimizeMutation.isPending ? 'Optimizing…' : 'Optimize'}
            </button>
          </div>
          {optimizeError && <p className="text-sm text-red-500">{optimizeError}</p>}
        </div>

        {/* Sign-ups list */}
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
            Signed up — {summary.totalSignups}
          </h2>
          {signups.length === 0 && (
            <p className="text-sm text-gray-400">No players signed up yet.</p>
          )}
          {signups.map(({ signupId, player, isPriority: dbPriority }) => {
            const isPriority = priorityMap[signupId] ?? dbPriority;
            return (
              <div key={signupId} className="bg-white rounded-xl border border-gray-200 p-4 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="font-medium text-gray-900 truncate">{player.name}</p>
                  <div className="flex gap-1 mt-1 flex-wrap">
                    {player.preferredPositions.map(pos => (
                      <span key={pos} className={`text-xs font-medium px-2 py-0.5 rounded-full ${POS_COLOR[pos] ?? 'bg-gray-100 text-gray-500'}`}>
                        {pos}
                      </span>
                    ))}
                  </div>
                </div>
                <button
                  onClick={() => togglePriority(signupId)}
                  className={`shrink-0 text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${
                    isPriority
                      ? 'bg-amber-50 border-amber-300 text-amber-700 hover:bg-amber-100'
                      : 'bg-gray-50 border-gray-200 text-gray-500 hover:bg-gray-100'
                  }`}
                >
                  {isPriority ? '★ Priority' : '☆ Priority'}
                </button>
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}
