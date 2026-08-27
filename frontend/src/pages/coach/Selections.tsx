import AppNav from '../../components/AppNav';
import { useState } from 'react';
import { meetingTime } from '../../utils';
import { useDateFormat } from '../../i18n/format';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { PitchView, POS_TAG, type SelectionPlayer, type Guest } from '../../components/PitchView';
import MatchEditForm, { initialMatchFields, matchUpdatePayload, type MatchEditFields } from '../../components/MatchEditForm';
import { Star } from '../../components/Icon';

interface FormationSlot { covered: boolean; required: number; filled: number }

interface OptimizationResult {
  formation: Record<string, FormationSlot> | null;
  deficit: number;
  objective: number | null;
  fairnessWeight: number; // α: 1 = fairness only, 0 = positions only
  selectedCount: number;
  solveTimeMs: number | null;
  optimizedAt: string;
}

interface MatchInfo {
  matchId: string;
  matchDate: string;
  matchTime: string;
  matchType: string;
  location: string;
  opponent: string | null;
  opponentId: string | null;
  matchCategory: string;
  serieLetter: string | null;
  status: string;
  minPlayers: number;
  maxPlayers: number;
  signupOpenDate: string;
  signupCloseDate: string;
  optimizationResult: OptimizationResult | null;
}

function useFairnessLabel() {
  const { t } = useTranslation();
  return (alpha: number): string => {
    if (alpha >= 0.66) return t('coach.fairnessHint');
    if (alpha <= 0.34) return t('coach.fitHint');
    return t('coach.fairnessBalanced');
  };
}

// ─── "Why this squad" explainer ────────────────────────────────────────────────

function WhySquad({ opt, minPlayers }: { opt: OptimizationResult; minPlayers: number }) {
  const { t } = useTranslation();
  const fairnessLabel = useFairnessLabel();
  const formation = opt.formation ?? {};
  const slots = Object.entries(formation);

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <span className="font-semibold text-gray-900">{t('coach.whyThisSquad')}</span>

      <div className="mt-4 space-y-4">
        {/* Run summary */}
        <div className="flex flex-wrap gap-2">
          <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${opt.deficit === 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
            {opt.deficit === 0 ? t('coach.squadComplete', { count: opt.selectedCount }) : t('coach.squadShort', { deficit: opt.deficit, min: minPlayers })}
          </span>
          <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-gray-100 text-gray-600">
            {fairnessLabel(opt.fairnessWeight)}
          </span>
        </div>

        {/* Formation coverage */}
        {slots.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">{t('coach.formationCoverage')}</p>
            <div className="flex flex-wrap gap-2">
              {slots.map(([pos, slot]) => (
                <span
                  key={pos}
                  className={`text-xs font-medium px-2 py-1 rounded-lg border ${
                    slot.filled >= slot.required ? 'border-green-200 bg-green-50 text-green-700' : 'border-amber-200 bg-amber-50 text-amber-700'
                  }`}
                  title={t(`positionsLong.${pos}`, { defaultValue: pos })}
                >
                  {pos} {slot.filled}/{slot.required} {slot.filled >= slot.required ? '✓' : '⚠'}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* How it works */}
        <div className="text-sm text-gray-600 space-y-1.5 border-t border-gray-100 pt-3">
          <p className="font-medium text-gray-700">{t('coach.howOptimizerChooses')}</p>
          <ul className="list-disc list-inside space-y-1 text-sm text-gray-500">
            <li>{t('coach.optFills')}</li>
            <li><span className="text-gray-700 font-medium">{t('coach.fairnessLabel')}</span> {t('coach.optFairnessBody')}</li>
            <li><span className="text-gray-700 font-medium">{t('coach.priorityPrefix')}<Star className="inline w-3 h-3 -mt-0.5 text-amber-500" />{t('coach.prioritySuffix')}</span> {t('coach.optPriorityBody')}</li>
            <li><span className="text-gray-700 font-medium">{t('coach.balanceLabel')}</span> {t('coach.optBalanceBody')} <span className="text-gray-700">{fairnessLabel(opt.fairnessWeight).toLowerCase()}</span>.</li>
          </ul>
          <p className="text-xs text-gray-400 pt-1">{t('coach.optReflects')}</p>
        </div>
      </div>
    </div>
  );
}

interface SelectionsResponse {
  match: MatchInfo;
  players: SelectionPlayer[];
  summary: { totalSignups: number; totalSelected: number };
}

interface SpotClaim {
  claimId: string;
  claimantId: string;
  claimantName: string;
  preferredPositions: string[];
  createdAt: string;
}

// ─── Main page ───────────────────────────────────────────────────────────────

export default function Selections() {
  const { t } = useTranslation();
  const { formatDate } = useDateFormat();
  const { matchId } = useParams<{ matchId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [selectedIds, setSelectedIds] = useState<Set<string> | null>(null);
  const [publishError, setPublishError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [guestName, setGuestName] = useState('');
  const [guestPosition, setGuestPosition] = useState('');
  const [showAddGuest, setShowAddGuest] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editFields, setEditFields] = useState<MatchEditFields | null>(null);
  const [showWhy, setShowWhy] = useState(false);
  const [addFilter, setAddFilter] = useState('');
  const [showReoptConfirm, setShowReoptConfirm] = useState(false);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);

  const { data, isLoading } = useQuery<SelectionsResponse>({
    queryKey: ['match-selections', matchId],
    queryFn: () => api.get(`/matches/${matchId}/selections`).then(r => r.data.data),
  });

  const { data: guests = [] } = useQuery<Guest[]>({
    queryKey: ['match-guests', matchId],
    queryFn: () => api.get(`/matches/${matchId}/guests`).then(r => r.data.data),
  });

  const { data: claims = [] } = useQuery<SpotClaim[]>({
    queryKey: ['match-claims', matchId],
    queryFn: () => api.get(`/matches/${matchId}/claims`).then(r => r.data.data),
  });

  const resolveClaimMutation = useMutation({
    mutationFn: ({ claimId, accept }: { claimId: string; accept: boolean }) =>
      api.put(`/claims/${claimId}/resolve`, { accept }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['match-claims', matchId] });
      qc.invalidateQueries({ queryKey: ['match-selections', matchId] });
      qc.invalidateQueries({ queryKey: ['matches'] });
    },
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

  // One Save for the whole Edit view: persist match details and the squad
  // together, then leave edit mode. Avoids the trap of two separate saves where
  // a coach could lose one set of changes.
  const saveAllMutation = useMutation({
    mutationFn: async ({ fields, ids }: { fields: MatchEditFields; ids: string[] }) => {
      await api.put(`/matches/${matchId}`, matchUpdatePayload(fields));
      await api.put(`/matches/${matchId}/selections`, { selectedPlayerIds: ids });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['match-selections', matchId] });
      qc.invalidateQueries({ queryKey: ['match-signups', matchId] });
      qc.invalidateQueries({ queryKey: ['matches'] });
      setSaveError('');
      setEditMode(false);
      setSelectedIds(null);
      setEditFields(null);
      setShowDiscardConfirm(false);
    },
    onError: (err: any) => setSaveError(err.response?.data?.error?.message ?? t('coach.saveFailed')),
  });

  const publishMutation = useMutation({
    mutationFn: () => api.post(`/matches/${matchId}/publish`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['matches'] }); navigate('/coach'); },
    onError: (err: any) => setPublishError(err.response?.data?.error?.message ?? t('coach.publishFailed')),
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

  function enterEdit() {
    setEditFields(initialMatchFields(data!.match));
    setSelectedIds(null);
    setSaveError('');
    setShowDiscardConfirm(false);
    setEditMode(true);
  }

  function exitEdit() {
    setEditMode(false);
    setSelectedIds(null);
    setEditFields(null);
    setSaveError('');
    setShowDiscardConfirm(false);
    setAddFilter('');
  }

  if (isLoading) return <div className="min-h-screen bg-gray-50 boca-page flex items-center justify-center text-gray-400">Loading…</div>;
  if (!data) return <div className="min-h-screen bg-gray-50 boca-page flex items-center justify-center text-red-500">{t('coach.matchNotFound')}</div>;

  const { match, players } = data;
  const isPublished = match.status === 'published';
  const date = new Date(`${match.matchDate}T${match.matchTime}`);
  const ids = selectedIds ?? new Set(players.filter(p => p.isSelected).map(p => p.player.userId));
  const selectedCount = ids.size + guests.length;
  const tooFew = selectedCount < match.minPlayers;
  const tooMany = selectedCount > match.maxPlayers;
  const selectionsDirty = players.some(p => p.isSelected !== ids.has(p.player.userId));
  const matchDirty = editFields != null && JSON.stringify(editFields) !== JSON.stringify(initialMatchFields(match));
  const dirty = selectionsDirty || matchDirty;

  const signedUpPlayers = players.filter(p => p.isSignedUp);
  const otherPlayers = players
    .filter(p => !p.isSignedUp)
    .filter(p => p.player.name.toLowerCase().includes(addFilter.trim().toLowerCase()));

  // A read-only / interactive player row, shared by view and edit modes.
  function PlayerRow({ p, interactive }: { p: SelectionPlayer; interactive: boolean }) {
    const { player, isPriority, isSignedUp, selectedByOptimization, manuallyAdjusted } = p;
    const isSelected = ids.has(player.userId);
    return (
      <div
        onClick={interactive ? () => togglePlayer(player.userId) : undefined}
        className={`rounded-xl border p-4 flex items-center gap-4 transition-colors ${interactive ? 'cursor-pointer' : ''} ${
          isSelected ? 'bg-green-50 border-green-300' : 'bg-white border-gray-200 opacity-60'
        }`}
      >
        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${
          isSelected ? 'bg-green-500 border-green-500' : 'border-gray-300'
        }`}>
          {isSelected && <span className="text-white text-xs">✓</span>}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="font-medium text-gray-900 truncate">{player.name}</p>
            {isPriority && <Star className="w-3.5 h-3.5 text-amber-600 shrink-0" />}
            {isSignedUp === false && <span className="text-xs text-gray-400 shrink-0">didn't sign up</span>}
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
  }

  return (
    <div className="min-h-screen bg-gray-50 boca-page">
      <AppNav backHref="/coach" backLabel={t('coach.matches')} />

      <main className="max-w-2xl mx-auto px-4 py-8 space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-extrabold text-gray-900">
              {formatDate(date, 'long')}
            </h1>
            <p className="text-gray-500 mt-1">
              {t('match.timeAndMeet', { time: match.matchTime.slice(0, 5), meet: meetingTime(match.matchTime) })} · {editMode ? t('coach.editingSquad') : t('coach.squad')}
              {match.opponent && <span className="text-gray-700 font-medium"> · vs {match.opponent}</span>}
            </p>
          </div>
          {!editMode && (
            <div className="flex gap-2 shrink-0">
              <button
                onClick={enterEdit}
                className="text-sm border border-gray-300 text-gray-600 hover:bg-gray-50 font-medium px-3 py-1.5 rounded-lg transition-colors"
              >
                {t('coach.edit')}
              </button>
              <button
                onClick={() => isPublished ? setShowReoptConfirm(true) : navigate(`/coach/matches/${matchId}#optimize`)}
                className="text-sm border border-gray-300 text-gray-600 hover:bg-gray-50 font-medium px-3 py-1.5 rounded-lg transition-colors"
              >
                {t('coach.reoptimize')}
              </button>
            </div>
          )}
        </div>

        {/* Re-optimize confirmation (published squads only) */}
        {showReoptConfirm && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 space-y-3">
            <p className="font-semibold text-amber-800">{t('coach.reoptimizeQ')}</p>
            <p className="text-sm text-amber-700">{t('coach.reoptBody')}</p>
            <div className="flex gap-2">
              <button
                onClick={() => navigate(`/coach/matches/${matchId}#optimize`)}
                className="text-sm bg-brand-green hover:bg-brand-green-700 text-white font-medium px-4 py-2 rounded-lg transition-colors"
              >
                {t('coach.continueToOptimizer')}
              </button>
              <button
                onClick={() => setShowReoptConfirm(false)}
                className="text-sm border border-gray-300 text-gray-600 hover:bg-gray-50 font-medium px-4 py-2 rounded-lg transition-colors"
              >
                {t('coach.keepCurrentSquad')}
              </button>
            </div>
          </div>
        )}

        {/* Counter + publish */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="font-semibold text-gray-900">
                {t('coach.selectedCount2', { count: selectedCount })}
                <span className={`ml-2 text-sm font-normal ${tooFew ? 'text-red-500' : tooMany ? 'text-orange-500' : 'text-gray-500'}`}>
                  {t('coach.minMax', { min: match.minPlayers, max: match.maxPlayers })}
                </span>
              </p>
              {tooFew && <p className="text-sm text-red-500 mt-0.5">{t('coach.needMoreN', { count: match.minPlayers - selectedCount })}</p>}
            </div>
            {!editMode && !isPublished && (
              <button onClick={() => { setPublishError(''); publishMutation.mutate(); }}
                disabled={publishMutation.isPending || tooFew}
                className="bg-brand-green hover:bg-brand-green-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
                {publishMutation.isPending ? t('coach.publishing') : t('coach.publish')}
              </button>
            )}
          </div>
          {publishError && <p className="text-sm text-red-500">{publishError}</p>}
          {isPublished && !editMode && (
            <p className="text-xs text-gray-500">
              {t('coach.publishedNote1')} <span className="font-medium">{t('coach.edit')}</span> {t('coach.publishedNote2')}
            </p>
          )}
        </div>

        {/* Spot claimants — players asking to take an open spot */}
        {claims.length > 0 && (
          <div className="bg-white rounded-xl border border-brand-green/40 p-5 space-y-3">
            <div>
              <h2 className="font-semibold text-gray-900">{t('coach.spotClaimants')}</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                {claims.length === 1
                  ? t('coach.claimOne')
                  : t('coach.claimMany', { count: claims.length })}
              </p>
            </div>
            {claims.map(c => (
              <div key={c.claimId} className="flex items-center gap-3 border-t border-gray-100 pt-3 first:border-0 first:pt-0">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-gray-900 text-sm truncate">{c.claimantName}</p>
                  <div className="flex items-center gap-1 mt-1 flex-wrap">
                    {c.preferredPositions.map(pos => (
                      <span key={pos} className={`text-xs font-medium px-2 py-0.5 rounded-full ${POS_TAG[pos] ?? 'bg-gray-100 text-gray-500'}`}>
                        {pos}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => resolveClaimMutation.mutate({ claimId: c.claimId, accept: true })}
                    disabled={resolveClaimMutation.isPending}
                    className="bg-brand-green hover:bg-brand-green-700 disabled:opacity-50 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
                  >
                    {t('coach.confirm')}
                  </button>
                  <button
                    onClick={() => resolveClaimMutation.mutate({ claimId: c.claimId, accept: false })}
                    disabled={resolveClaimMutation.isPending}
                    className="border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
                  >
                    {t('coach.decline')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Why this squad — tucked behind a small toggle */}
        {match.optimizationResult && (
          <div className="space-y-2">
            <button
              onClick={() => setShowWhy(v => !v)}
              className="text-xs font-medium text-brand-green hover:text-brand-green-700"
            >
              {showWhy ? t('coach.hideExplanation') : t('coach.whyThisSquadQ')}
            </button>
            {showWhy && <WhySquad opt={match.optimizationResult} minPlayers={match.minPlayers} />}
          </div>
        )}

        {/* Pitch formation view */}
        {(ids.size > 0 || guests.length > 0) && <PitchView players={players} ids={ids} matchType={match.matchType} guests={guests} />}

        {editMode && editFields ? (
          <>
            {/* Edit match details */}
            <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
              <h2 className="font-semibold text-gray-900">{t('coach.matchDetails')}</h2>
              <MatchEditForm value={editFields} onChange={setEditFields} matchType={match.matchType} />
            </div>

            {/* Squad editor */}
            <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
              <h2 className="font-semibold text-gray-900">{t('coach.squad')}</h2>

              {/* Signed-up players */}
              <div className="space-y-2 pt-1">
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{t('coach.signedUpHeading2', { count: signedUpPlayers.length })}</h3>
                {signedUpPlayers.length === 0 && <p className="text-sm text-gray-400">{t('coach.noSignups')}</p>}
                {signedUpPlayers.map(p => <PlayerRow key={p.player.userId} p={p} interactive />)}
              </div>

              {/* Add players who didn't sign up */}
              <div className="space-y-2 pt-2 border-t border-gray-100">
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{t('coach.addAnotherPlayer')}</h3>
                <p className="text-xs text-gray-400 -mt-1">{t('coach.addAnotherPlayerHint')}</p>
                <input
                  type="text"
                  placeholder={t('coach.searchPlayers')}
                  value={addFilter}
                  onChange={e => setAddFilter(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green"
                />
                {otherPlayers.length === 0 && <p className="text-sm text-gray-400">{t('coach.noMatchingPlayers')}</p>}
                {otherPlayers.map(p => <PlayerRow key={p.player.userId} p={p} interactive />)}
              </div>
            </div>

            {/* Guest players (external, non-registered) */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-gray-700">{t('coach.guestPlayers')}</h2>
                <button
                  onClick={() => setShowAddGuest(v => !v)}
                  className="text-xs font-medium text-brand-green hover:text-brand-green-700"
                >
                  {showAddGuest ? t('common.cancel') : t('coach.addGuestPlus')}
                </button>
              </div>

              {showAddGuest && (
                <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
                  <input
                    type="text"
                    placeholder={t('coach.guestName')}
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
                    <option value="">{t('coach.positionOptional')}</option>
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
                    {addGuestMutation.isPending ? t('coach.adding') : t('coach.addGuest')}
                  </button>
                </div>
              )}

              {guests.length === 0 && !showAddGuest && (
                <p className="text-sm text-gray-400">{t('coach.noGuests')}</p>
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
                    {t('coach.remove')}
                  </button>
                </div>
              ))}
              <p className="text-xs text-gray-400">{t('coach.guestsImmediate')}</p>
            </div>

            {/* One save for the whole edit (match details + squad) */}
            <div className="sticky bottom-0 bg-gray-50 -mx-4 px-4 py-3 border-t border-gray-200">
              {saveError && <p className="text-sm text-red-500 mb-2">{saveError}</p>}
              {isPublished && tooFew && <p className="text-xs text-red-500 mb-2">{t('coach.belowMinimum', { min: match.minPlayers })}</p>}
              {isPublished && !tooFew && <p className="text-xs text-gray-500 mb-2">{t('coach.saveNotifies')}</p>}
              {showDiscardConfirm ? (
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm text-amber-700">{t('coach.discardQ')}</p>
                  <div className="flex gap-2 shrink-0">
                    <button onClick={exitEdit} className="text-sm border border-gray-300 text-gray-600 hover:bg-gray-50 font-medium px-4 py-2 rounded-lg transition-colors">{t('coach.discard')}</button>
                    <button onClick={() => setShowDiscardConfirm(false)} className="text-sm bg-brand-green hover:bg-brand-green-700 text-white font-medium px-4 py-2 rounded-lg transition-colors">{t('coach.keepEditing')}</button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-end gap-2">
                  <button
                    onClick={() => dirty ? setShowDiscardConfirm(true) : exitEdit()}
                    className="text-sm border border-gray-300 text-gray-600 hover:bg-gray-50 font-medium px-4 py-2 rounded-lg transition-colors"
                  >
                    {t('common.cancel')}
                  </button>
                  <button
                    onClick={() => { setSaveError(''); saveAllMutation.mutate({ fields: editFields, ids: [...ids] }); }}
                    disabled={saveAllMutation.isPending || !dirty || (isPublished && tooFew)}
                    className="bg-brand-green hover:bg-brand-green-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
                  >
                    {saveAllMutation.isPending ? t('coach.saving') : isPublished ? t('coach.saveAndNotify') : t('coach.saveChanges')}
                  </button>
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            {/* Read-only squad list */}
            <div className="space-y-2">
              <h2 className="text-sm font-semibold text-gray-700">{t('coach.signedUpPlayersHeading', { count: signedUpPlayers.length })}</h2>
              {signedUpPlayers.length === 0 && <p className="text-sm text-gray-400">{t('coach.noSignups')}</p>}
              {signedUpPlayers.map(p => <PlayerRow key={p.player.userId} p={p} interactive={false} />)}
            </div>

            {/* Guests (read-only) */}
            {guests.length > 0 && (
              <div className="space-y-2">
                <h2 className="text-sm font-semibold text-gray-700">{t('coach.guestPlayers')}</h2>
                {guests.map(g => (
                  <div key={g.guest_id} className="bg-white rounded-xl border border-gray-200 p-4 flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-gray-400 flex items-center justify-center shrink-0">
                      <span className="text-white text-[9px] font-bold">GST</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-900 text-sm">{g.name}</p>
                      {g.position && <p className="text-xs text-gray-400">{g.position}</p>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
