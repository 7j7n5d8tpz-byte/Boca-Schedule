import AppNav from '../../components/AppNav';
import { useState } from 'react';
import { meetingTime } from '../../utils';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import { PitchView, POS_TAG, type SelectionPlayer, type Guest } from '../../components/PitchView';

interface MatchInfo {
  matchId: string;
  matchDate: string;
  matchTime: string;
  matchType: string;
  status: string;
  minPlayers: number;
  maxPlayers: number;
}

interface SelectionsResponse {
  match: MatchInfo;
  players: SelectionPlayer[];
  summary: { totalSignups: number; totalSelected: number };
}

// ─── Main page ───────────────────────────────────────────────────────────────

export default function Selections() {
  const { matchId } = useParams<{ matchId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [selectedIds, setSelectedIds] = useState<Set<string> | null>(null);
  const [publishError, setPublishError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [guestName, setGuestName] = useState('');
  const [guestPosition, setGuestPosition] = useState('');
  const [showAddGuest, setShowAddGuest] = useState(false);

  const { data, isLoading } = useQuery<SelectionsResponse>({
    queryKey: ['match-selections', matchId],
    queryFn: () => api.get(`/matches/${matchId}/selections`).then(r => r.data.data),
  });

  const { data: guests = [] } = useQuery<Guest[]>({
    queryKey: ['match-guests', matchId],
    queryFn: () => api.get(`/matches/${matchId}/guests`).then(r => r.data.data),
  });

  const addGuestMutation = useMutation({
    mutationFn: ({ name, position }: { name: string; position: string }) =>
      api.post(`/matches/${matchId}/guests`, { name, position: position || undefined }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['match-guests', matchId] });
      setGuestName(''); setGuestPosition(''); setShowAddGuest(false);
    },
  });

  const removeGuestMutation = useMutation({
    mutationFn: (guestId: string) => api.delete(`/matches/${matchId}/guests/${guestId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['match-guests', matchId] }),
  });

  const saveMutation = useMutation({
    mutationFn: (ids: string[]) =>
      api.put(`/matches/${matchId}/selections`, { selectedPlayerIds: ids }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['match-selections', matchId] });
      qc.invalidateQueries({ queryKey: ['matches'] });
      setSaveError('');
    },
    onError: (err: any) => setSaveError(err.response?.data?.error?.message ?? 'Failed to save'),
  });

  const publishMutation = useMutation({
    mutationFn: () => api.post(`/matches/${matchId}/publish`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['matches'] }); navigate('/coach'); },
    onError: (err: any) => setPublishError(err.response?.data?.error?.message ?? 'Failed to publish'),
  });

  function togglePlayer(userId: string) {
    // If selectedIds was never initialised (onSuccess removed in TanStack v5),
    // seed it from the server data before mutating.
    const base = selectedIds ?? new Set(
      data!.players.filter(p => p.isSelected).map(p => p.player.userId)
    );
    const next = new Set(base);
    next.has(userId) ? next.delete(userId) : next.add(userId);
    setSelectedIds(next);
  }

  if (isLoading) return <div className="min-h-screen bg-gray-50 boca-page flex items-center justify-center text-gray-400">Loading…</div>;
  if (!data) return <div className="min-h-screen bg-gray-50 boca-page flex items-center justify-center text-red-500">Match not found</div>;

  const { match, players } = data;
  const date = new Date(`${match.matchDate}T${match.matchTime}`);
  const ids = selectedIds ?? new Set(players.filter(p => p.isSelected).map(p => p.player.userId));
  const selectedCount = ids.size + guests.length;
  const tooFew = selectedCount < match.minPlayers;
  const tooMany = selectedCount > match.maxPlayers;
  const isDirty = players.some(p => p.isSelected !== ids.has(p.player.userId));

  return (
    <div className="min-h-screen bg-gray-50 boca-page">
      <AppNav backHref={`/coach/matches/${matchId}`} backLabel="← Sign-ups" />

      <main className="max-w-2xl mx-auto px-4 py-8 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
          </h1>
          <p className="text-gray-500 mt-1">{match.matchTime.slice(0, 5)} (meet at {meetingTime(match.matchTime)}) · Selections</p>
        </div>

        {/* Counter + publish */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="font-semibold text-gray-900">
                {selectedCount} selected
                <span className={`ml-2 text-sm font-normal ${tooFew ? 'text-red-500' : tooMany ? 'text-orange-500' : 'text-gray-500'}`}>
                  (min {match.minPlayers} · max {match.maxPlayers})
                </span>
              </p>
              {tooFew && <p className="text-sm text-red-500 mt-0.5">Need {match.minPlayers - selectedCount} more</p>}
            </div>
            <div className="flex gap-2">
              {isDirty && (
                <button onClick={() => { setSaveError(''); saveMutation.mutate([...ids]); }}
                  disabled={saveMutation.isPending}
                  className="text-sm font-medium px-3 py-2 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-gray-700 transition-colors disabled:opacity-50">
                  {saveMutation.isPending ? 'Saving…' : 'Save'}
                </button>
              )}
              <button onClick={() => { setPublishError(''); publishMutation.mutate(); }}
                disabled={publishMutation.isPending || tooFew || isDirty}
                className="bg-brand-green hover:bg-brand-green-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
                {publishMutation.isPending ? 'Publishing…' : 'Publish'}
              </button>
            </div>
          </div>
          {saveError && <p className="text-sm text-red-500">{saveError}</p>}
          {publishError && <p className="text-sm text-red-500">{publishError}</p>}
          {isDirty && <p className="text-xs text-amber-600">Unsaved changes — save before publishing.</p>}
        </div>

        {/* Pitch formation view */}
        {(ids.size > 0 || guests.length > 0) && <PitchView players={players} ids={ids} matchType={match.matchType} guests={guests} />}

        {/* Guest players */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Guest players</h2>
            <button
              onClick={() => setShowAddGuest(v => !v)}
              className="text-xs font-medium text-brand-green hover:text-brand-green-700"
            >
              {showAddGuest ? 'Cancel' : '+ Add guest'}
            </button>
          </div>

          {showAddGuest && (
            <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
              <input
                type="text"
                placeholder="Guest name"
                value={guestName}
                onChange={e => setGuestName(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green"
                autoFocus
              />
              <select
                value={guestPosition}
                onChange={e => setGuestPosition(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green bg-white"
              >
                <option value="">Position (optional)</option>
                {(match.matchType === 'futsal'
                  ? ['GK', 'WIN', 'MID', 'STR']
                  : ['GK', 'DEF', 'WIN', 'MID', 'STR']
                ).map(p => <option key={p} value={p}>{p}</option>)}
              </select>
              <button
                onClick={() => { if (guestName.trim()) addGuestMutation.mutate({ name: guestName.trim(), position: guestPosition }); }}
                disabled={!guestName.trim() || addGuestMutation.isPending}
                className="w-full bg-brand-green hover:bg-brand-green-700 disabled:opacity-50 text-white text-sm font-medium py-2 rounded-lg transition-colors"
              >
                {addGuestMutation.isPending ? 'Adding…' : 'Add guest'}
              </button>
            </div>
          )}

          {guests.length === 0 && !showAddGuest && (
            <p className="text-sm text-gray-400">No guest players added.</p>
          )}

          {guests.map(g => (
            <div key={g.guest_id} className="bg-white rounded-xl border border-gray-200 p-4 flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-gray-400 flex items-center justify-center shrink-0">
                <span className="text-white text-[9px] font-bold">GST</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-gray-900 text-sm">{g.name}</p>
                {g.position && <p className="text-xs text-gray-400">{g.position}</p>}
              </div>
              <button
                onClick={() => removeGuestMutation.mutate(g.guest_id)}
                disabled={removeGuestMutation.isPending}
                className="text-xs text-red-400 hover:text-red-600 font-medium disabled:opacity-50"
              >
                Remove
              </button>
            </div>
          ))}
        </div>

        {/* Player list */}
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">All signed-up players</h2>
          {players.map(({ player, isPriority, selectedByOptimization, manuallyAdjusted }) => {
            const isSelected = ids.has(player.userId);
            return (
              <div key={player.userId} onClick={() => togglePlayer(player.userId)}
                className={`cursor-pointer rounded-xl border p-4 flex items-center gap-4 transition-colors ${
                  isSelected ? 'bg-green-50 border-green-300' : 'bg-white border-gray-200 opacity-60'
                }`}>
                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                  isSelected ? 'bg-green-500 border-green-500' : 'border-gray-300'
                }`}>
                  {isSelected && <span className="text-white text-xs">✓</span>}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-gray-900 truncate">{player.name}</p>
                    {isPriority && <span className="text-xs text-amber-600 font-medium shrink-0">★</span>}
                    {manuallyAdjusted && <span className="text-xs text-gray-400 shrink-0">manual</span>}
                    {selectedByOptimization && !manuallyAdjusted && <span className="text-xs text-blue-400 shrink-0">optimizer</span>}
                  </div>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    {player.preferredPositions.map(pos => (
                      <span key={pos} className={`text-xs font-medium px-2 py-0.5 rounded-full ${POS_TAG[pos] ?? 'bg-gray-100 text-gray-500'}`}>
                        {pos}
                      </span>
                    ))}
                    <span className="text-xs text-gray-400">
                      {player.totalPlayed} played · {player.totalSignups} signed up
                    </span>
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
