import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import RavenIcon from '../../components/RavenIcon';

type Position = 'GK' | 'DEF' | 'WIN' | 'MID' | 'STR';

const ALL_POSITIONS: Position[] = ['GK', 'DEF', 'WIN', 'MID', 'STR'];

const POS_COLOR: Record<string, string> = {
  GK:  'bg-yellow-100 text-yellow-700 border-yellow-300',
  DEF: 'bg-blue-100 text-blue-700 border-blue-300',
  WIN: 'bg-green-100 text-green-700 border-green-300',
  MID: 'bg-purple-100 text-purple-700 border-purple-300',
  STR: 'bg-red-100 text-red-700 border-red-300',
};

export default function PlayerProfile() {
  const { user, logout } = useAuth();
  const qc = useQueryClient();

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [positions, setPositions] = useState<Position[]>([]);
  const [saveError, setSaveError] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['player-stats', user?.userId],
    queryFn: () => api.get(`/players/${user!.userId}/statistics`).then(r => r.data.data),
    enabled: !!user,
    onSuccess: (d: any) => {
      if (!editing) {
        setName(d.player.name);
        setPositions(d.player.preferredPositions ?? []);
      }
    },
  } as any);

  const saveMutation = useMutation({
    mutationFn: () =>
      api.put(`/players/${user!.userId}/profile`, {
        name: name.trim() || undefined,
        preferredPositions: positions,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['player-stats', user?.userId] });
      setSaveError('');
      setEditing(false);
    },
    onError: (err: any) => {
      setSaveError(err.response?.data?.error?.message ?? 'Failed to save');
    },
  });

  function togglePosition(pos: Position) {
    setPositions(prev =>
      prev.includes(pos) ? prev.filter(p => p !== pos) : [...prev, pos]
    );
  }

  const stats = data?.seasonStats;

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
          <span className="text-sm text-white/70">{user?.name}</span>
          <button onClick={logout} className="text-sm text-white/60 hover:text-white/90">Logout</button>
        </div>
      </nav>

      <main className="max-w-2xl mx-auto px-4 py-8 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900">My Profile</h1>
          {!editing && (
            <button
              onClick={() => setEditing(true)}
              className="text-sm text-brand-green hover:underline"
            >
              Edit
            </button>
          )}
        </div>

        {/* Profile card */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          {isLoading && <p className="text-sm text-gray-400">Loading…</p>}

          {!isLoading && data && (
            <>
              {editing ? (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                    <input
                      value={name}
                      onChange={e => setName(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Preferred Positions</label>
                    <div className="flex gap-2 flex-wrap">
                      {ALL_POSITIONS.map(pos => (
                        <button
                          key={pos}
                          onClick={() => togglePosition(pos)}
                          className={`text-sm font-medium px-3 py-1.5 rounded-full border transition-colors ${
                            positions.includes(pos)
                              ? POS_COLOR[pos]
                              : 'bg-gray-50 border-gray-200 text-gray-500'
                          }`}
                        >
                          {pos}
                        </button>
                      ))}
                    </div>
                  </div>
                  {saveError && <p className="text-sm text-red-500">{saveError}</p>}
                  <div className="flex gap-2">
                    <button
                      onClick={() => saveMutation.mutate()}
                      disabled={saveMutation.isPending}
                      className="bg-brand-green hover:bg-brand-green-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
                    >
                      {saveMutation.isPending ? 'Saving…' : 'Save changes'}
                    </button>
                    <button
                      onClick={() => setEditing(false)}
                      className="text-sm text-gray-500 hover:text-gray-700 px-4 py-2"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-lg font-semibold text-gray-900">{data.player.name}</p>
                  <p className="text-sm text-gray-500">{user?.email}</p>
                  <div className="flex gap-1.5 flex-wrap mt-2">
                    {(data.player.preferredPositions ?? []).map((pos: string) => (
                      <span key={pos} className={`text-xs font-medium px-2 py-0.5 rounded-full border ${POS_COLOR[pos] ?? 'bg-gray-100 text-gray-500 border-gray-200'}`}>
                        {pos}
                      </span>
                    ))}
                    {(data.player.preferredPositions ?? []).length === 0 && (
                      <span className="text-sm text-gray-400">No positions set</span>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Season stats */}
        {stats && (
          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Season Stats</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: 'Matches played', value: stats.total_played ?? 0 },
                { label: 'Selected', value: stats.total_selected ?? 0 },
                { label: 'Sign-ups', value: stats.total_signups ?? 0 },
                { label: 'Attendance', value: `${stats.attendance_rate ?? 0}%` },
              ].map(s => (
                <div key={s.label} className="bg-white rounded-xl border border-gray-200 p-4 text-center">
                  <p className="text-2xl font-bold text-gray-900">{s.value}</p>
                  <p className="text-xs text-gray-500 mt-1">{s.label}</p>
                </div>
              ))}
            </div>

            {(stats.total_played ?? 0) > 0 && (
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: 'Goals', value: stats.total_goals ?? 0 },
                  { label: 'Assists', value: stats.total_assists ?? 0 },
                  { label: 'Avg rating', value: stats.avg_rating ? Number(stats.avg_rating).toFixed(1) : '—' },
                ].map(s => (
                  <div key={s.label} className="bg-white rounded-xl border border-gray-200 p-4 text-center">
                    <p className="text-2xl font-bold text-gray-900">{s.value}</p>
                    <p className="text-xs text-gray-500 mt-1">{s.label}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
