import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';

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
          className="text-sm text-blue-600 hover:underline"
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

  const { data, isLoading } = useQuery({
    queryKey: ['matches', 'coach-all'],
    queryFn: () => api.get('/matches/upcoming?status=all').then(r => r.data.data),
  });

  const matches: Match[] = data?.matches ?? [];
  const totalSignups = matches.reduce((s, m) => s + m.currentSignups, 0);
  const readyToOptimize = matches.filter(m => m.status === 'signup_closed').length;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Nav */}
      <nav className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <span className="font-bold text-gray-900 text-lg">
          Boca Schedule{' '}
          <span className="text-blue-600 text-sm font-normal">Coach</span>
        </span>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-600">{user?.name}</span>
          <button onClick={logout} className="text-sm text-gray-500 hover:text-gray-700">
            Logout
          </button>
        </div>
      </nav>

      <main className="max-w-2xl mx-auto px-4 py-8 space-y-8">
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
            className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            + New match
          </Link>
        </div>

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
