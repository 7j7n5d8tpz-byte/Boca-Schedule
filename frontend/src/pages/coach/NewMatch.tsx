import AppNav from '../../components/AppNav';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import LocationPicker, { encodeLocation } from '../../components/LocationPicker';

export default function NewMatch() {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const today = new Date().toISOString().slice(0, 10);

  const [matchDate, setMatchDate] = useState('');
  const [matchTime, setMatchTime] = useState('20:00');
  const [venue, setVenue] = useState('');
  const [court, setCourt] = useState('');
  const [opponent, setOpponent] = useState('');
  const [matchType, setMatchType] = useState<'futsal' | '7-player' | '11-player'>('7-player');
  const [matchCategory, setMatchCategory] = useState<'serie' | 'pokal'>('serie');
  const [serieLetter, setSerieLetter] = useState('A');
  const [signupOpenDate, setSignupOpenDate] = useState(today);
  const [signupCloseDate, setSignupCloseDate] = useState('');
  const [minPlayers, setMinPlayers] = useState(7);
  const [maxPlayers, setMaxPlayers] = useState(10);
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: () => api.post('/matches', {
      matchDate,
      matchTime: matchTime + ':00',
      location: encodeLocation(venue, court),
      opponent: opponent.trim() || undefined,
      matchType,
      matchCategory,
      serieLetter: matchCategory === 'serie' ? serieLetter : undefined,
      // Interpret the picked dates in the coach's local timezone (00:00 open,
      // 20:00 deadline), then send the absolute UTC instant. Sending a bare
      // "…T20:00:00Z" treated the deadline as UTC, putting it an hour or two
      // off for CET/CEST users.
      signupOpenDate: new Date(signupOpenDate + 'T00:00:00').toISOString(),
      signupCloseDate: new Date(signupCloseDate + 'T20:00:00').toISOString(),
      minPlayers,
      maxPlayers,
      priorityEnabled: true,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['matches'] });
      navigate('/coach');
    },
    onError: (err: any) => {
      setError(err.response?.data?.error?.message ?? 'Failed to create match');
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!matchDate || !signupCloseDate) { setError('Match date and signup deadline are required'); return; }
    if (!venue) { setError('Please select a venue'); return; }
    if (minPlayers > maxPlayers) { setError('Min players cannot exceed max players'); return; }
    mutation.mutate();
  }

  return (
    <div className="min-h-screen bg-gray-50 boca-page">
      <AppNav backHref="/coach" backLabel="← Matches" />

      <main className="max-w-lg mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-6">New match</h1>

        <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="matchDate" className="block text-sm font-medium text-gray-700 mb-1">Match date</label>
              <input
                id="matchDate"
                type="date"
                required
                value={matchDate}
                onChange={e => setMatchDate(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green"
              />
            </div>
            <div>
              <label htmlFor="matchTime" className="block text-sm font-medium text-gray-700 mb-1">Kick-off time</label>
              <input
                id="matchTime"
                type="time"
                required
                value={matchTime}
                onChange={e => setMatchTime(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Venue <span className="text-gray-400 font-normal text-xs">
                · {matchType === 'futsal' ? 'Hall (optional)' : 'Court number (optional)'}
              </span>
            </label>
            <LocationPicker
              venue={venue}
              court={court}
              onVenueChange={setVenue}
              onCourtChange={setCourt}
              matchType={matchType}
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Opponent team <span className="text-gray-400 font-normal">(optional)</span></label>
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
                onChange={e => {
                  const t = e.target.value as 'futsal' | '7-player' | '11-player';
                  setMatchType(t);
                  if (t === 'futsal') setMinPlayers(5);
                  else if (t === '7-player') setMinPlayers(7);
                  else if (t === '11-player') setMinPlayers(11);
                }}
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
                {['A','B','C','D','E','F'].map(l => (
                  <option key={l} value={l}>{l}</option>
                ))}
              </select>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Signup opens</label>
              <input
                type="date"
                required
                value={signupOpenDate}
                onChange={e => setSignupOpenDate(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green"
              />
            </div>
            <div>
              <label htmlFor="signupClose" className="block text-sm font-medium text-gray-700 mb-1">Signup deadline</label>
              <input
                id="signupClose"
                type="date"
                required
                value={signupCloseDate}
                onChange={e => setSignupCloseDate(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green"
              />
              <p className="text-xs text-gray-400 mt-1">Closes 20:00 (8 PM) local time</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Min players</label>
              <input
                type="number"
                min={1}
                max={25}
                value={minPlayers}
                onChange={e => setMinPlayers(Number(e.target.value))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Max players</label>
              <input
                type="number"
                min={1}
                max={25}
                value={maxPlayers}
                onChange={e => setMaxPlayers(Number(e.target.value))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green"
              />
            </div>
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}

          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              disabled={mutation.isPending}
              className="flex-1 bg-brand-green hover:bg-brand-green-700 disabled:opacity-50 text-white text-sm font-medium py-2.5 rounded-lg transition-colors"
            >
              {mutation.isPending ? 'Creating…' : 'Create match'}
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
