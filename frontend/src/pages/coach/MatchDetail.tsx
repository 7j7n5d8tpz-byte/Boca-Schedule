import AppNav from '../../components/AppNav';
import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, Link, useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { formatLocation } from '../../components/LocationPicker';
import MatchEditForm, { initialMatchFields, matchUpdatePayload, type MatchEditFields } from '../../components/MatchEditForm';
import { meetingTime, mapsUrl } from '../../utils';
import { useDateFormat } from '../../i18n/format';
import Icon, { Star } from '../../components/Icon';

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
  location: string;
  opponent: string | null;
  opponentId: string | null;
  matchType: string;
  matchCategory: string;
  serieLetter: string | null;
  status: string;
  cancelledBy: CancelledBy;
  minPlayers: number;
  maxPlayers: number;
  signupOpenDate: string;
  signupCloseDate: string;
}

interface SignupsResponse {
  match: MatchData;
  signups: SignupPlayer[];
  summary: { totalSignups: number; prioritySignups: number };
}

// Whoever calls a match off forfeits it: the opponent cancelling hands us a 3-0,
// cancelling ourselves hands them one. A match called off by neither side
// (weather, postponed, mutually agreed) is recorded with no result at all.
type CancelledBy = 'us' | 'opponent' | null;

const CANCEL_OPTIONS: { value: CancelledBy; labelKey: string; hintKey: string }[] = [
  { value: 'opponent', labelKey: 'coach.outcomeOpponent',  hintKey: 'coach.cancelHintOpponent' },
  { value: 'us',       labelKey: 'coach.outcomeUs',        hintKey: 'coach.cancelHintUs' },
  { value: null,       labelKey: 'coach.cancelNeither',    hintKey: 'coach.outcomePostponed' },
];

function useCancelOutcomeText() {
  const { t } = useTranslation();
  return (cancelledBy: CancelledBy) => {
    if (cancelledBy === 'opponent') return t('coach.outcomeTextOpponent');
    if (cancelledBy === 'us')       return t('coach.outcomeTextUs');
    return t('coach.outcomeTextNeither');
  };
}

function CancelledByPicker({ value, onChange, disabled }: { value: CancelledBy; onChange: (v: CancelledBy) => void; disabled?: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2">
      {CANCEL_OPTIONS.map(o => (
        <label
          key={String(o.value)}
          className={`flex items-start gap-3 rounded-lg border px-3 py-2 cursor-pointer transition-colors ${
            value === o.value ? 'border-red-300 bg-white' : 'border-gray-200 bg-white/60 hover:bg-white'
          }`}
        >
          <input
            type="radio"
            name="cancelled-by"
            className="mt-1 accent-red-600"
            checked={value === o.value}
            disabled={disabled}
            onChange={() => onChange(o.value)}
          />
          <span className="min-w-0">
            <span className="block text-sm font-medium text-gray-900">{t(o.labelKey)}</span>
            <span className="block text-xs text-gray-500">{t(o.hintKey)}</span>
          </span>
        </label>
      ))}
    </div>
  );
}

const POS_COLOR: Record<string, string> = {
  GK:  'bg-yellow-100 text-yellow-700',
  DEF: 'bg-blue-100 text-blue-700',
  WIN: 'bg-green-100 text-green-700',
  MID: 'bg-purple-100 text-purple-700',
  STR: 'bg-red-100 text-red-700',
};

export default function MatchDetail() {
  const { t } = useTranslation();
  const { formatDate } = useDateFormat();
  const cancelOutcomeText = useCancelOutcomeText();
  const { matchId } = useParams<{ matchId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();

  const [priorityMap, setPriorityMap] = useState<Record<string, boolean>>({});
  const [optimizeError, setOptimizeError] = useState('');
  const [fairnessWeight, setFairnessWeight] = useState(50); // 0 = positions, 100 = fairness
  const [showEdit, setShowEdit] = useState(false);
  const [editFields, setEditFields] = useState<MatchEditFields | null>(null);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [cancelledBy, setCancelledBy] = useState<CancelledBy>(null);
  const [showOutcomeEdit, setShowOutcomeEdit] = useState(false);

  const { data, isLoading } = useQuery<SignupsResponse>({
    queryKey: ['match-signups', matchId],
    queryFn: () => api.get(`/matches/${matchId}/signups`).then(r => r.data.data),
  });

  // Re-optimize from the squad page deep-links here with #optimize — scroll the
  // optimizer card into view so the coach lands on the action, not page top.
  useEffect(() => {
    if (location.hash === '#optimize') {
      setTimeout(() => document.getElementById('optimize')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
    }
  }, [location.hash, isLoading]);

  const priorityMutation = useMutation({
    mutationFn: ({ signupId, value }: { signupId: string; value: boolean }) =>
      api.put(`/signups/${signupId}/priority`, { isPriority: value }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['match-signups', matchId] }),
  });

  const editMutation = useMutation({
    mutationFn: () => api.put(`/matches/${matchId}`, matchUpdatePayload(editFields!)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['match-signups', matchId] });
      qc.invalidateQueries({ queryKey: ['matches'] });
      setShowEdit(false);
      setEditFields(null);
    },
  });

  function openEdit() {
    setEditFields(initialMatchFields(match));
    setShowEdit(true);
  }

  const statusMutation = useMutation({
    mutationFn: (status: string) => api.put(`/matches/${matchId}`, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['match-signups', matchId] });
      qc.invalidateQueries({ queryKey: ['matches'] });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: () => api.put(`/matches/${matchId}`, { status: 'cancelled', cancelledBy }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['matches'] });
      navigate('/coach');
    },
  });

  // Fixing the outcome afterwards — the walkover result follows whichever side
  // is recorded here, and clearing it removes the result again.
  const outcomeMutation = useMutation({
    mutationFn: (value: CancelledBy) => api.put(`/matches/${matchId}`, { cancelledBy: value }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['match-signups', matchId] });
      qc.invalidateQueries({ queryKey: ['matches'] });
      setShowOutcomeEdit(false);
    },
  });

  const optimizeMutation = useMutation({
    mutationFn: () => api.post(`/matches/${matchId}/optimize`, { fairnessWeight: 1 - fairnessWeight / 100 }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['matches'] });
      qc.invalidateQueries({ queryKey: ['match-selections', matchId] });
      navigate(`/coach/matches/${matchId}/selections`);
    },
    onError: (err: any) => {
      setOptimizeError(err.response?.data?.error?.message ?? t('coach.optimizeFailed'));
    },
  });

  function togglePriority(signupId: string) {
    // Seed from server data if this signupId hasn't been toggled yet
    const current = signupId in priorityMap
      ? priorityMap[signupId]
      : data?.signups.find(s => s.signupId === signupId)?.isPriority ?? false;
    const next = !current;
    setPriorityMap(m => ({ ...m, [signupId]: next }));
    priorityMutation.mutate({ signupId, value: next });
  }

  if (isLoading) {
    return <div className="min-h-screen bg-gray-50 boca-page flex items-center justify-center text-gray-400">{t('common.loading')}</div>;
  }

  if (!data) {
    return <div className="min-h-screen bg-gray-50 boca-page flex items-center justify-center text-red-500">{t('coach.matchNotFound')}</div>;
  }

  const { match, signups, summary } = data;
  const date = new Date(`${match.matchDate}T${match.matchTime}`);

  return (
    <div className="min-h-screen bg-gray-50 boca-page">
      <AppNav backHref="/coach" backLabel={t('coach.matches')} />

      <main className="max-w-2xl mx-auto px-4 py-8 space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-extrabold text-gray-900">
              {formatDate(date, 'long')}
            </h1>
            <p className="text-gray-500 mt-1">
              {t('match.timeAndMeet', { time: match.matchTime.slice(0, 5), meet: meetingTime(match.matchTime) })} ·{' '}
              <a href={mapsUrl(match.location)} target="_blank" rel="noopener noreferrer" className="hover:text-brand-green hover:underline" title={t('match.openInMaps')}>
                {formatLocation(match.location, match.matchType, t)}
              </a>
              {match.opponent && <span className="text-gray-700 font-medium"> vs {match.opponent}</span>}
              {' '}{t('coach.signedUpCount', { count: summary.totalSignups })}
              {summary.prioritySignups > 0 && (
                <span className="ml-2 text-amber-600 font-medium">{t('coach.priorityCount', { count: summary.prioritySignups })}</span>
              )}
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            <button
              onClick={openEdit}
              className="text-sm border border-gray-300 text-gray-600 hover:bg-gray-50 font-medium px-3 py-1.5 rounded-lg transition-colors"
            >
              {t('coach.edit')}
            </button>
            {match.status !== 'cancelled' && (
              <button
                onClick={() => setShowCancelConfirm(true)}
                className="text-sm border border-red-200 text-red-600 hover:bg-red-50 font-medium px-3 py-1.5 rounded-lg transition-colors"
              >
                {t('coach.cancelMatch')}
              </button>
            )}
          </div>
        </div>

        {/* Status controls */}
        {match.status === 'draft' && (
          <div className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 flex items-center justify-between gap-4">
            <p className="text-sm text-gray-500">{t('coach.signupsNotOpen')}</p>
            <button
              onClick={() => statusMutation.mutate('signup_open')}
              disabled={statusMutation.isPending}
              className="shrink-0 bg-brand-green hover:bg-brand-green-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              {t('coach.openSignups')}
            </button>
          </div>
        )}
        {match.status === 'signup_open' && (
          <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 flex items-center justify-between gap-4">
            {/* Past the deadline the window stays open while the match is short of
                players, so say so — the coach shouldn't think this is a bug. */}
            <p className="text-sm text-green-700">
              {new Date(match.signupCloseDate) < new Date() && summary.totalSignups < match.maxPlayers
                ? t('coach.signupsOpenLate', { count: summary.totalSignups, max: match.maxPlayers })
                : t('coach.signupsOpen')}
            </p>
            <button
              onClick={() => statusMutation.mutate('signup_closed')}
              disabled={statusMutation.isPending}
              className="shrink-0 border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50 text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              {t('coach.closeSignups')}
            </button>
          </div>
        )}
        {match.status === 'signup_closed' && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-xl px-4 py-3 flex items-center justify-between gap-4">
            <p className="text-sm text-yellow-700">{t('coach.signupsClosed')}</p>
            <button
              onClick={() => statusMutation.mutate('signup_open')}
              disabled={statusMutation.isPending}
              className="shrink-0 border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50 text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              {t('coach.reopenSignups')}
            </button>
          </div>
        )}
        {match.status === 'optimized' && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 flex items-center justify-between gap-4">
            <p className="text-sm text-blue-700">{t('coach.optimizerSelected')}</p>
            <Link
              to={`/coach/matches/${matchId}/selections`}
              className="shrink-0 bg-brand-green hover:bg-brand-green-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              {t('coach.reviewPublish')}
            </Link>
          </div>
        )}
        {match.status === 'published' && (
          <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 flex items-center justify-between gap-4">
            <p className="text-sm text-green-700">{t('coach.matchPublished')}</p>
            <Link
              to={`/coach/matches/${matchId}/selections`}
              className="shrink-0 border border-gray-300 text-gray-600 hover:bg-gray-50 text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              {t('coach.manageSquad')}
            </Link>
          </div>
        )}
        {match.status === 'completed' && (
          <div className="bg-gray-100 border border-gray-200 rounded-xl px-4 py-3">
            <p className="text-sm text-gray-500">{t('coach.completedNotice')}</p>
          </div>
        )}
        {match.status === 'cancelled' && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 space-y-3">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-red-800">{t('coach.cancelledNotice')}</p>
                <p className="text-sm text-red-600 mt-0.5">{cancelOutcomeText(match.cancelledBy)}</p>
              </div>
              <button
                onClick={() => { setShowOutcomeEdit(v => !v); setCancelledBy(match.cancelledBy); }}
                className="shrink-0 text-sm border border-red-200 text-red-600 hover:bg-red-100 font-medium px-3 py-1.5 rounded-lg transition-colors"
              >
                {showOutcomeEdit ? t('coach.close') : t('coach.change')}
              </button>
            </div>
            {showOutcomeEdit && (
              <>
                <CancelledByPicker value={cancelledBy} onChange={setCancelledBy} disabled={outcomeMutation.isPending} />
                <button
                  onClick={() => outcomeMutation.mutate(cancelledBy)}
                  disabled={outcomeMutation.isPending}
                  className="text-sm bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-medium px-4 py-2 rounded-lg transition-colors"
                >
                  {outcomeMutation.isPending ? t('coach.saving') : t('coach.saveOutcome')}
                </button>
                {outcomeMutation.isError && <p className="text-sm text-red-500">{t('coach.outcomeFailed')}</p>}
              </>
            )}
          </div>
        )}

        {/* Edit form */}
        {showEdit && editFields && (
          <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
            <h2 className="font-semibold text-gray-900">{t('coach.editMatchDetails')}</h2>
            <MatchEditForm value={editFields} onChange={setEditFields} matchType={match.matchType} />
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => { setShowEdit(false); setEditFields(null); }}
                className="text-sm border border-gray-300 text-gray-600 hover:bg-gray-50 font-medium px-4 py-2 rounded-lg transition-colors"
              >
                {t('coach.discard2')}
              </button>
              <button
                onClick={() => editMutation.mutate()}
                disabled={editMutation.isPending}
                className="text-sm bg-brand-green hover:bg-brand-green-700 disabled:opacity-50 text-white font-medium px-4 py-2 rounded-lg transition-colors"
              >
                {editMutation.isPending ? t('coach.saving') : t('coach.saveChanges')}
              </button>
            </div>
            {editMutation.isError && <p className="text-sm text-red-500">{t('coach.saveChangesFailed')}</p>}
          </div>
        )}

        {/* Cancel confirmation */}
        {showCancelConfirm && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-5 space-y-3">
            <p className="font-semibold text-red-800">{t('coach.cancelMatchQ')}</p>
            <p className="text-sm text-red-600">{t('coach.cancelMatchBody')}</p>
            <p className="text-sm font-medium text-red-800">{t('coach.whoCancelled')}</p>
            <CancelledByPicker value={cancelledBy} onChange={setCancelledBy} disabled={cancelMutation.isPending} />
            <div className="flex gap-2">
              <button
                onClick={() => cancelMutation.mutate()}
                disabled={cancelMutation.isPending}
                className="text-sm bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-medium px-4 py-2 rounded-lg transition-colors"
              >
                {cancelMutation.isPending ? t('coach.cancelling') : t('coach.yesCancelMatch')}
              </button>
              <button
                onClick={() => setShowCancelConfirm(false)}
                className="text-sm border border-gray-300 text-gray-600 hover:bg-gray-50 font-medium px-4 py-2 rounded-lg transition-colors"
              >
                {t('coach.keepMatch')}
              </button>
            </div>
          </div>
        )}

        {/* Optimize card — a cancelled match has nothing left to select. */}
        {match.status !== 'cancelled' && (
        <div id="optimize" className="bg-white rounded-xl border border-gray-200 p-5 space-y-4 scroll-mt-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="font-semibold text-gray-900">{t('coach.runOptimizer')}</p>
              <p className="text-sm text-gray-500 mt-0.5">
                {t('coach.optimizerHint', { min: match.minPlayers, max: match.maxPlayers })}
              </p>
            </div>
            <button
              onClick={() => { setOptimizeError(''); optimizeMutation.mutate(); }}
              disabled={optimizeMutation.isPending || signups.length === 0}
              className="shrink-0 bg-brand-green hover:bg-brand-green-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              {optimizeMutation.isPending ? t('coach.optimizing') : t('coach.optimize')}
            </button>
          </div>

          {/* Weight lever */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-gray-500">
              <span className="flex items-center gap-1"><Icon name="scale" className="w-3.5 h-3.5" /> {t('coach.fairness')}</span>
              <span className="font-medium text-gray-600">
                {fairnessWeight === 50 ? t('coach.balanced') : fairnessWeight < 50 ? t('coach.fairnessPriority') : t('coach.positionsPriority')}
              </span>
              <span className="flex items-center gap-1"><Icon name="puzzle" className="w-3.5 h-3.5" /> {t('coach.positions')}</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={10}
              value={fairnessWeight}
              onChange={e => setFairnessWeight(Number(e.target.value))}
              className="w-full accent-brand-green h-2 cursor-pointer"
            />
            <p className="text-xs text-gray-400">
              {t('coach.balanceHint')}
            </p>
          </div>

          {optimizeError && <p className="text-sm text-red-500">{optimizeError}</p>}

          {/* Before optimizing, offer a direct route to build the squad by hand.
              Once optimized/published the banner above already links to the squad. */}
          {match.status !== 'optimized' && match.status !== 'published' && (
            <div className="border-t border-gray-100 pt-3">
              <Link
                to={`/coach/matches/${matchId}/selections`}
                className="text-sm font-medium text-brand-green hover:text-brand-green-700"
              >
                {t('coach.pickManually')}
              </Link>
              <p className="text-xs text-gray-400 mt-0.5">
                {t('coach.pickManuallyHint')}
              </p>
            </div>
          )}
        </div>
        )}

        {/* Sign-ups list */}
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-gray-700">
            {t('coach.signedUpHeading', { count: summary.totalSignups })}
          </h2>
          {signups.length === 0 && (
            <p className="text-sm text-gray-400">{t('coach.noSignupsYet')}</p>
          )}
          {signups.map(({ signupId, player, isPriority: dbPriority }) => {
            const isPriority = priorityMap[signupId] ?? dbPriority;
            return (
              <div key={signupId} className="bg-white rounded-xl border border-gray-200 p-4 flex items-center justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-gray-900 truncate">{player.name}</p>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
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
                  <span className="flex items-center gap-1"><Star filled={isPriority} className="w-3.5 h-3.5" /> {t('coach.priority')}</span>
                </button>
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}
