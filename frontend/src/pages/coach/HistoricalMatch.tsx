import AppNav from '../../components/AppNav';
import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../api/client';

interface RosterPlayer {
  userId: string;
  name: string;
  preferredPositions: string[];
}

export default function HistoricalMatch() {
  const navigate = useNavigate();

  const [matchDate, setMatchDate] = useState('');
  const [matchTime, setMatchTime] = useState('18:00');
  const [opponent, setOpponent] = useState('');
  const [matchType, setMatchType] = useState<'futsal' | '7-player' | '11-player'>('7-player');
  const [matchCategory, setMatchCategory] = useState<'serie' | 'pokal'>('serie');
  const [serieLetter, setSerieLetter] = useState('A');
  const [participants, setParticipants] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');

  const { data: roster = [] } = useQuery<RosterPlayer[]>({
    queryKey: ['all-players'],
    queryFn: () => api.get('/players').then(r => r.data.data),
  });

  const mutation = useMutation({
    mutationFn: () => api.post('/matches/historical', {
      matchDate,
      matchTime,
      opponent: opponent.trim() || undefined,
      matchType,
      matchCategory,
      serieLetter: matchCategory === 'serie' ? serieLetter : undefined,
      participantIds: [...participants],
    }),
    onSuccess: (res) => {
      // Continue into the normal result wizard for this freshly-created match.
      navigate(`/matches/${res.data.data.matchId}/results`);
    },
    onError: (err: any) => setError(err.response?.data?.error?.message ?? 'Failed to create historical match'),
  });

  function toggle(userId: string) {
    setParticipants(prev => {
      const next = new Set(prev);
      next.has(userId) ? next.delete(userId) : next.add(userId);
      return next;
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!matchDate) { setError('Match date is required'); return; }
    mutation.mutate();
  }

  const filtered = roster.filter(p => p.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="min-h-screen bg-gray-50 boca-page">
      <AppNav backHref="/coach" backLabel="← Matches" />

      <main className="max-w-lg mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Record past match</h1>
        <p className="text-sm text-gray-500 mb-6">
          Backfill an already-played match. Next you'll enter the score, scorers, assists and man of the match.
        </p>

        <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Match date</label>
              <input
                type="date"
                required
                value={matchDate}
                onChange={e => setMatchDate(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Kick-off time</label>
              <input
                type="time"
                value={matchTime}
                onChange={e => setMatchTime(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Opponent <span className="text-gray-400 font-normal">(optional)</span></label>
            <input
              type="text"
              value={opponent}
              onChange={e => setOpponent(e.target.value)}
              placeholder="e.g. FC Vesterbro"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Match type</label>
              <select
                value={matchType}
                onChange={e => setMatchType(e.target.value as 'futsal' | '7-player' | '11-player')}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green"
              >
                <option value="7-player">7-player</option>
                <option value="futsal">Futsal</option>
                <option value="11-player">11-player</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
              <select
                value={matchCategory}
                onChange={e => setMatchCategory(e.target.value as 'serie' | 'pokal')}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green"
              >
                <option value="serie">Serie</option>
                <option value="pokal">Pokal</option>
              </select>
            </div>
          </div>

          {matchCategory === 'serie' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Serie letter</label>
              <select
                value={serieLetter}
                onChange={e => setSerieLetter(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green"
              >
                {['A','B','C','D','E','F'].map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
          )}

          {/* Participants */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Who played? <span className="text-gray-400 font-normal">({participants.size} selected)</span>
            </label>
            <p className="text-xs text-gray-400 mb-2">
              Pick the players you know took part — at least the scorers, assisters and man of the match. Only these players will be creditable in the next step.
            </p>
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search players…"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green mb-2"
            />
            <div className="max-h-56 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-50">
              {filtered.length === 0 && <p className="text-sm text-gray-400 text-center py-4">No players found</p>}
              {filtered.map(p => {
                const on = participants.has(p.userId);
                return (
                  <button
                    type="button"
                    key={p.userId}
                    onClick={() => toggle(p.userId)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors ${on ? 'bg-brand-green-50' : 'hover:bg-gray-50'}`}
                  >
                    <span className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${on ? 'bg-green-500 border-green-500' : 'border-gray-300'}`}>
                      {on && <span className="text-white text-xs">✓</span>}
                    </span>
                    <span className="text-sm text-gray-900 flex-1 truncate">{p.name}</span>
                    <span className="text-xs text-gray-400 shrink-0">{p.preferredPositions.join(', ')}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}

          <div className="flex gap-3 pt-1">
            <button
              type="submit"
              disabled={mutation.isPending}
              className="flex-1 bg-brand-green hover:bg-brand-green-700 disabled:opacity-50 text-white text-sm font-medium py-2.5 rounded-lg transition-colors"
            >
              {mutation.isPending ? 'Creating…' : 'Continue to result →'}
            </button>
            <Link
              to="/coach"
              className="flex-1 text-center border border-gray-300 text-gray-700 text-sm font-medium py-2.5 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Cancel
            </Link>
          </div>
        </form>
      </main>
    </div>
  );
}
