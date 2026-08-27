import AppNav from '../../components/AppNav';
import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import OpponentPicker from '../../components/OpponentPicker';

interface RosterPlayer {
  userId: string;
  name: string;
  preferredPositions: string[];
}

export default function HistoricalMatch() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [matchDate, setMatchDate] = useState('');
  const [matchTime, setMatchTime] = useState('18:00');
  const [opponentId, setOpponentId] = useState<string | null>(null);
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
      opponentId: opponentId ?? undefined,
      matchType,
      matchCategory,
      serieLetter: matchCategory === 'serie' ? serieLetter : undefined,
      participantIds: [...participants],
    }),
    onSuccess: (res) => {
      // Continue into the normal result wizard for this freshly-created match.
      navigate(`/matches/${res.data.data.matchId}/results`);
    },
    onError: (err: any) => setError(err.response?.data?.error?.message ?? t('coach.historicalFailed')),
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
    if (!matchDate) { setError(t('coach.dateRequired')); return; }
    mutation.mutate();
  }

  const filtered = roster.filter(p => p.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="min-h-screen bg-gray-50 boca-page">
      <AppNav backHref="/coach" backLabel={t('coach.matches')} />

      <main className="max-w-lg mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">{t('coach.historicalTitle')}</h1>
        <p className="text-sm text-gray-500 mb-6">
          {t('coach.historicalSub')}
        </p>

        <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="matchDate" className="block text-sm font-medium text-gray-700 mb-1">{t('matchForm.matchDate')}</label>
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
              <label htmlFor="matchTime" className="block text-sm font-medium text-gray-700 mb-1">{t('matchForm.kickOff')}</label>
              <input
                id="matchTime"
                type="time"
                value={matchTime}
                onChange={e => setMatchTime(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green"
              />
            </div>
          </div>

          <div>
            <span className="block text-sm font-medium text-gray-700 mb-1">{t('matchForm.opponent')} <span className="text-gray-400 font-normal">{t('common.optional')}</span></span>
            <OpponentPicker opponentId={opponentId} onChange={(id) => setOpponentId(id)} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="matchType" className="block text-sm font-medium text-gray-700 mb-1">{t('matchForm.matchType')}</label>
              <select
                id="matchType"
                value={matchType}
                onChange={e => setMatchType(e.target.value as 'futsal' | '7-player' | '11-player')}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green"
              >
                <option value="7-player">{t('matchTypes.7-player')}</option>
                <option value="futsal">{t('matchTypes.futsal')}</option>
                <option value="11-player">{t('matchTypes.11-player')}</option>
              </select>
            </div>
            <div>
              <label htmlFor="category" className="block text-sm font-medium text-gray-700 mb-1">{t('matchForm.category')}</label>
              <select
                id="category"
                value={matchCategory}
                onChange={e => setMatchCategory(e.target.value as 'serie' | 'pokal')}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green"
              >
                <option value="serie">{t('matchForm.serie')}</option>
                <option value="pokal">{t('matchForm.pokal')}</option>
              </select>
            </div>
          </div>

          {matchCategory === 'serie' && (
            <div>
              <label htmlFor="serieLetter" className="block text-sm font-medium text-gray-700 mb-1">{t('matchForm.serieLetter')}</label>
              <select
                id="serieLetter"
                value={serieLetter}
                onChange={e => setSerieLetter(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green"
              >
                {['Mester','A','B','C','D','E','F'].map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
          )}

          {/* Participants */}
          <div role="group" aria-labelledby="who-played-label">
            <span id="who-played-label" className="block text-sm font-medium text-gray-700 mb-1">
              {t('coach.whoPlayed')} <span className="text-gray-400 font-normal">{t('coach.selectedCount', { count: participants.size })}</span>
            </span>
            <p className="text-xs text-gray-400 mb-2">
              {t('coach.whoPlayedHint')}
            </p>
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={t('coach.searchPlayers')}
              aria-label={t('coach.searchPlayers')}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green mb-2"
            />
            <div className="max-h-56 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-50">
              {filtered.length === 0 && <p className="text-sm text-gray-400 text-center py-4">{t('coach.noPlayersFound')}</p>}
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
              {mutation.isPending ? t('coach.creating') : t('coach.continueToResult')}
            </button>
            <Link
              to="/coach"
              className="flex-1 text-center border border-gray-300 text-gray-700 text-sm font-medium py-2.5 rounded-lg hover:bg-gray-50 transition-colors"
            >
              {t('common.cancel')}
            </Link>
          </div>
        </form>
      </main>
    </div>
  );
}
