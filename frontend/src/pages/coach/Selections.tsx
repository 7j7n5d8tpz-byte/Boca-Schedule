import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';

interface SelectionPlayer {
  player: { userId: string; name: string; preferredPositions: string[] };
  isPriority: boolean;
  isSelected: boolean;
  selectedByOptimization: boolean;
  manuallyAdjusted: boolean;
  optimizationScore: number | null;
}

interface MatchInfo {
  matchId: string;
  matchDate: string;
  matchTime: string;
  status: string;
  minPlayers: number;
  maxPlayers: number;
}

interface SelectionsResponse {
  match: MatchInfo;
  players: SelectionPlayer[];
  summary: { totalSignups: number; totalSelected: number };
}

const POS_COLOR: Record<string, string> = {
  GK:  'bg-yellow-100 text-yellow-700',
  DEF: 'bg-blue-100 text-blue-700',
  WIN: 'bg-green-100 text-green-700',
  MID: 'bg-purple-100 text-purple-700',
  STR: 'bg-red-100 text-red-700',
};

export default function Selections() {
  const { matchId } = useParams<{ matchId: string }>();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [selectedIds, setSelectedIds] = useState<Set<string> | null>(null);
  const [publishError, setPublishError] = useState('');
  const [saveError, setSaveError] = useState('');

  const { data, isLoading } = useQuery<SelectionsResponse>({
    queryKey: ['match-selections', matchId],
    queryFn: () => api.get(`/matches/${matchId}/selections`).then(r => r.data.data),
    onSuccess: (d: SelectionsResponse) => {
      if (selectedIds === null) {
        setSelectedIds(new Set(d.players.filter(p => p.isSelected).map(p => p.player.userId)));
      }
    },
  } as any);

  const saveMutation = useMutation({
    mutationFn: (ids: string[]) =>
      api.put(`/matches/${matchId}/selections`, { selectedPlayerIds: ids }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['match-selections', matchId] });
      qc.invalidateQueries({ queryKey: ['matches'] });
      setSaveError('');
    },
    onError: (err: any) => {
      setSaveError(err.response?.data?.error?.message ?? 'Failed to save changes');
    },
  });

  const publishMutation = useMutation({
    mutationFn: () => api.post(`/matches/${matchId}/publish`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['matches'] });
      navigate('/coach');
    },
    onError: (err: any) => {
      setPublishError(err.response?.data?.error?.message ?? 'Failed to publish');
    },
  });

  function togglePlayer(userId: string) {
    setSelectedIds(prev => {
      const next = new Set(prev ?? []);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  function saveChanges() {
    if (!selectedIds) return;
    setSaveError('');
    saveMutation.mutate([...selectedIds]);
  }

  if (isLoading) {
    return <div className="min-h-screen bg-gray-50 flex items-center justify-center text-gray-400">Loading…</div>;
  }

  if (!data) {
    return <div className="min-h-screen bg-gray-50 flex items-center justify-center text-red-500">Match not found</div>;
  }

  const { match, players } = data;
  const date = new Date(`${match.matchDate}T${match.matchTime}`);
  const ids = selectedIds ?? new Set(players.filter(p => p.isSelected).map(p => p.player.userId));
  const selectedCount = ids.size;
  const tooFew = selectedCount < match.minPlayers;
  const tooMany = selectedCount > match.maxPlayers;

  const isDirty = data.players.some(p => {
    const wasSelected = p.isSelected;
    const isNowSelected = ids.has(p.player.userId);
    return wasSelected !== isNowSelected;
  });

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link to={`/coach/matches/${matchId}`} className="text-gray-400 hover:text-gray-600 text-sm">← Sign-ups</Link>
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
            {match.matchTime.slice(0, 5)} · Selections
          </p>
        </div>

        {/* Counter + publish */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="font-semibold text-gray-900">
                {selectedCount} selected
                <span className={`ml-2 text-sm font-normal ${tooFew ? 'text-red-500' : tooMany ? 'text-orange-500' : 'text-gray-500'}`}>
                  (min {match.minPlayers} · max {match.maxPlayers})
                </span>
              </p>
              {tooFew && <p className="text-sm text-red-500 mt-0.5">Need {match.minPlayers - selectedCount} more player{match.minPlayers - selectedCount > 1 ? 's' : ''}</p>}
            </div>
            <div className="flex gap-2">
              {isDirty && (
                <button
                  onClick={saveChanges}
                  disabled={saveMutation.isPending}
                  className="text-sm font-medium px-3 py-2 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-gray-700 transition-colors disabled:opacity-50"
                >
                  {saveMutation.isPending ? 'Saving…' : 'Save'}
                </button>
              )}
              <button
                onClick={() => { setPublishError(''); publishMutation.mutate(); }}
                disabled={publishMutation.isPending || tooFew || isDirty}
                className="bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
              >
                {publishMutation.isPending ? 'Publishing…' : 'Publish'}
              </button>
            </div>
          </div>
          {saveError && <p className="text-sm text-red-500">{saveError}</p>}
          {publishError && <p className="text-sm text-red-500">{publishError}</p>}
          {isDirty && <p className="text-xs text-amber-600">Unsaved changes — save before publishing.</p>}
        </div>

        {/* Player list */}
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
            All signed-up players
          </h2>
          {players.map(({ player, isPriority, selectedByOptimization, manuallyAdjusted }) => {
            const isSelected = ids.has(player.userId);
            return (
              <div
                key={player.userId}
                onClick={() => togglePlayer(player.userId)}
                className={`cursor-pointer rounded-xl border p-4 flex items-center justify-between gap-4 transition-colors ${
                  isSelected
                    ? 'bg-green-50 border-green-300'
                    : 'bg-white border-gray-200 opacity-60'
                }`}
              >
                <div className="min-w-0 flex items-center gap-3">
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                    isSelected ? 'bg-green-500 border-green-500' : 'border-gray-300'
                  }`}>
                    {isSelected && <span className="text-white text-xs">✓</span>}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-gray-900 truncate">{player.name}</p>
                      {isPriority && (
                        <span className="text-xs text-amber-600 font-medium shrink-0">★</span>
                      )}
                      {manuallyAdjusted && (
                        <span className="text-xs text-gray-400 shrink-0">manual</span>
                      )}
                      {selectedByOptimization && !manuallyAdjusted && (
                        <span className="text-xs text-blue-400 shrink-0">optimizer</span>
                      )}
                    </div>
                    <div className="flex gap-1 mt-1 flex-wrap">
                      {player.preferredPositions.map(pos => (
                        <span key={pos} className={`text-xs font-medium px-2 py-0.5 rounded-full ${POS_COLOR[pos] ?? 'bg-gray-100 text-gray-500'}`}>
                          {pos}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}
