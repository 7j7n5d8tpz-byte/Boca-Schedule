import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';

interface Match {
  matchId: string;
  matchDate: string;
  matchTime: string;
  location: string;
  matchType: string;
  signupCloseDate: string;
  minPlayers: number;
  maxPlayers: number;
  currentSignups: number;
  userSignedUp: boolean;
  signupDeadlinePassed: boolean;
}

function MatchCard({ match }: { match: Match }) {
  const qc = useQueryClient();

  const signupMutation = useMutation({
    mutationFn: () => api.post('/signups', { matchId: match.matchId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['matches'] }),
  });

  const deadline = new Date(match.signupCloseDate);
  const deadlinePassed = deadline < new Date();

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
      <div className="flex items-start justify-between">
        <div>
          <p className="font-semibold text-gray-900">
            {new Date(match.matchDate).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })} &mdash; {match.matchTime.slice(0, 5)}
          </p>
          <p className="text-sm text-gray-500">{match.location} <span className="capitalize">({match.matchType})</span></p>
        </div>
        {match.userSignedUp && (
          <span className="bg-green-100 text-green-700 text-xs font-medium px-2.5 py-1 rounded-full">Signed up</span>
        )}
      </div>

      <div className="flex gap-4 text-sm text-gray-600">
        <span>Players: {match.currentSignups}/{match.maxPlayers}</span>
        <span>Deadline: {deadline.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
      </div>

      <div className="w-full bg-gray-100 rounded-full h-1.5">
        <div
          className="bg-blue-500 h-1.5 rounded-full transition-all"
          style={{ width: `${Math.min(100, (match.currentSignups / match.maxPlayers) * 100)}%` }}
        />
      </div>

      {!match.userSignedUp && !deadlinePassed && (
        <button
          onClick={() => signupMutation.mutate()}
          disabled={signupMutation.isPending}
          className="w-full mt-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium py-2 rounded-lg transition-colors"
        >
          {signupMutation.isPending ? 'Signing up...' : 'Sign Up'}
        </button>
      )}
      {deadlinePassed && !match.userSignedUp && (
        <p className="text-xs text-gray-400 text-center">Signup closed</p>
      )}
    </div>
  );
}

export default function PlayerDashboard() {
  const { user, logout } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ['matches'],
    queryFn: () => api.get('/matches/upcoming').then((r) => r.data.data),
  });

  const { data: statsData } = useQuery({
    queryKey: ['stats', user?.userId],
    queryFn: () => api.get(`/players/${user!.userId}/statistics`).then((r) => r.data.data),
    enabled: !!user,
  });

  const stats = statsData?.seasonStats;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Nav */}
      <nav className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <span className="font-bold text-gray-900 text-lg">Boca Schedule</span>
        <div className="flex items-center gap-4">
          <Link to="/profile" className="text-sm text-gray-600 hover:text-gray-900">{user?.name}</Link>
          <button onClick={logout} className="text-sm text-gray-500 hover:text-gray-700">Logout</button>
        </div>
      </nav>

      <main className="max-w-2xl mx-auto px-4 py-8 space-y-8">
        {/* Welcome */}
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
            ].map((s) => (
              <div key={s.label} className="bg-white rounded-xl border border-gray-200 p-4 text-center">
                <p className="text-2xl font-bold text-gray-900">{s.value}</p>
                <p className="text-xs text-gray-500 mt-1">{s.label}</p>
              </div>
            ))}
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
