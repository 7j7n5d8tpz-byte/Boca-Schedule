import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import RavenIcon from '../components/RavenIcon';

interface SelectionPlayer {
  player: { userId: string; name: string; preferredPositions: string[] };
  isPriority: boolean;
  isSelected: boolean;
}

interface PerformanceRow {
  playerId: string;
  name: string;
  preferredPositions: string[];
  attended: boolean;
  goals: number;
  assists: number;
  saves: number;
}

const POS_COLOR: Record<string, string> = {
  GK: 'bg-yellow-100 text-yellow-700',
  DEF: 'bg-blue-100 text-blue-700',
  WIN: 'bg-green-100 text-green-700',
  MID: 'bg-purple-100 text-purple-700',
  STR: 'bg-red-100 text-red-700',
};

function NumInput({ value, onChange, min = 0 }: { value: number; onChange: (v: number) => void; min?: number }) {
  return (
    <input
      type="number"
      min={min}
      value={value}
      onChange={e => onChange(Math.max(min, Number(e.target.value)))}
      className="w-14 border border-gray-300 rounded-lg px-2 py-1 text-sm text-center focus:outline-none focus:ring-2 focus:ring-brand-green"
    />
  );
}

export default function MatchResults() {
  const { matchId } = useParams<{ matchId: string }>();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [goalsFor, setGoalsFor]       = useState(0);
  const [goalsAgainst, setGoalsAgainst] = useState(0);
  const [rows, setRows]               = useState<PerformanceRow[]>([]);
  const [error, setError]             = useState('');

  // Fetch selected players for this match
  const { data: selectionsData, isLoading: selectionsLoading } = useQuery({
    queryKey: ['match-selections', matchId],
    queryFn: () => api.get(`/matches/${matchId}/selections`).then(r => r.data.data),
  });

  // Fetch existing results (if already recorded)
  const { data: existingResults, isLoading: resultsLoading } = useQuery({
    queryKey: ['match-results', matchId],
    queryFn: () => api.get(`/matches/${matchId}/results`).then(r => r.data.data),
  });

  // Seed rows from selections + existing performance data
  useEffect(() => {
    if (!selectionsData) return;
    const selected: SelectionPlayer[] = selectionsData.players.filter((p: SelectionPlayer) => p.isSelected);
    const existingPerf: Record<string, any> = {};
    (existingResults?.performances ?? []).forEach((p: any) => { existingPerf[p.playerId] = p; });

    setRows(selected.map((sp: SelectionPlayer) => {
      const ex = existingPerf[sp.player.userId];
      return {
        playerId: sp.player.userId,
        name: sp.player.name,
        preferredPositions: sp.player.preferredPositions,
        attended: ex?.attended ?? true,
        goals: ex?.goals ?? 0,
        assists: ex?.assists ?? 0,
        saves: ex?.saves ?? 0,
      };
    }));

    if (existingResults?.result) {
      setGoalsFor(existingResults.result.goalsFor);
      setGoalsAgainst(existingResults.result.goalsAgainst);
    }
  }, [selectionsData, existingResults]);

  function updateRow(playerId: string, field: keyof PerformanceRow, value: any) {
    setRows(prev => prev.map(r => r.playerId === playerId ? { ...r, [field]: value } : r));
  }

  const saveMutation = useMutation({
    mutationFn: () => api.post(`/matches/${matchId}/results`, {
      goalsFor,
      goalsAgainst,
      players: rows,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['match-results', matchId] });
      qc.invalidateQueries({ queryKey: ['team-statistics'] });
      qc.invalidateQueries({ queryKey: ['matches'] });
      navigate('/statistics');
    },
    onError: (err: any) => setError(err.response?.data?.error?.message ?? 'Failed to save results'),
  });

  const teamGoalsFromPlayers = rows.filter(r => r.attended).reduce((s, r) => s + r.goals, 0);
  const discrepancy = goalsFor !== teamGoalsFromPlayers;

  if (selectionsLoading || resultsLoading) {
    return <div className="min-h-screen bg-gray-50 flex items-center justify-center text-gray-400">Loading…</div>;
  }

  const match = selectionsData?.match;
  const date = match ? new Date(`${match.matchDate}T${match.matchTime}`) : null;

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-brand-dark border-b border-brand-green/40 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link to="/statistics" className="text-white/50 hover:text-white/80 text-sm">← Statistics</Link>
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
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Record match result</h1>
          {date && (
            <p className="text-gray-500 mt-1">
              {date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })} · {match.matchTime.slice(0, 5)}
            </p>
          )}
        </div>

        {/* Score card */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          <h2 className="font-semibold text-gray-900">Final score</h2>
          <div className="flex items-center justify-center gap-6">
            <div className="text-center">
              <p className="text-xs text-gray-500 mb-2">Boca (us)</p>
              <NumInput value={goalsFor} onChange={setGoalsFor} />
            </div>
            <span className="text-2xl font-bold text-gray-400">—</span>
            <div className="text-center">
              <p className="text-xs text-gray-500 mb-2">Opponent</p>
              <NumInput value={goalsAgainst} onChange={setGoalsAgainst} />
            </div>
          </div>
          {discrepancy && rows.some(r => r.attended) && (
            <p className="text-xs text-amber-600 text-center">
              Player goals total ({teamGoalsFromPlayers}) doesn't match team score ({goalsFor}) — check individual entries
            </p>
          )}
        </div>

        {/* Player rows */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">Player performance</h2>
            <p className="text-xs text-gray-400 mt-0.5">Only selected players are listed. Toggle attended, then fill in stats.</p>
          </div>

          {rows.length === 0 && (
            <p className="text-sm text-gray-400 px-5 py-6">No selected players found for this match.</p>
          )}

          <div className="divide-y divide-gray-50">
            {rows.map(row => {
              const isGK = row.preferredPositions.includes('GK');
              return (
                <div key={row.playerId} className={`px-5 py-3 transition-colors ${row.attended ? '' : 'opacity-50 bg-gray-50'}`}>
                  <div className="flex items-center gap-3 flex-wrap">
                    {/* Attended toggle */}
                    <button
                      onClick={() => updateRow(row.playerId, 'attended', !row.attended)}
                      className={`w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${
                        row.attended ? 'bg-green-500 border-green-500' : 'border-gray-300'
                      }`}
                    >
                      {row.attended && <span className="text-white text-xs">✓</span>}
                    </button>

                    {/* Name + positions */}
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{row.name}</p>
                      {row.preferredPositions.map(pos => (
                        <span key={pos} className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${POS_COLOR[pos] ?? 'bg-gray-100 text-gray-500'}`}>{pos}</span>
                      ))}
                    </div>

                    {/* Stats — only when attended */}
                    {row.attended && (
                      <div className="flex items-center gap-3 flex-wrap">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs text-gray-400">⚽</span>
                          <NumInput value={row.goals}   onChange={v => updateRow(row.playerId, 'goals', v)} />
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs text-gray-400">🎯</span>
                          <NumInput value={row.assists} onChange={v => updateRow(row.playerId, 'assists', v)} />
                        </div>
                        {isGK && (
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs text-gray-400">🧤</span>
                            <NumInput value={row.saves} onChange={v => updateRow(row.playerId, 'saves', v)} />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="px-5 py-3 border-t border-gray-100 flex items-center gap-2 text-xs text-gray-400">
            <span>⚽ = goals</span>
            <span>·</span>
            <span>🎯 = assists</span>
            <span>·</span>
            <span>🧤 = saves (GK only)</span>
          </div>
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="flex gap-3">
          <button
            onClick={() => { setError(''); saveMutation.mutate(); }}
            disabled={saveMutation.isPending}
            className="flex-1 bg-brand-green hover:bg-brand-green-700 disabled:opacity-50 text-white text-sm font-medium py-2.5 rounded-lg transition-colors"
          >
            {saveMutation.isPending ? 'Saving…' : existingResults?.result ? 'Update result' : 'Save result'}
          </button>
          <Link to="/statistics"
            className="flex-1 text-center border border-gray-300 text-gray-700 text-sm font-medium py-2.5 rounded-lg hover:bg-gray-50 transition-colors">
            Cancel
          </Link>
        </div>
      </main>
    </div>
  );
}
