import AppNav from '../../components/AppNav';
import { useState, useEffect } from 'react';
import { useQuery, useQueries, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { PitchView, POS_TAG, type SelectionPlayer } from '../../components/PitchView';
import { meetingTime } from '../../utils';
import { formatLocation } from '../../components/LocationPicker';
import Icon, { Star } from '../../components/Icon';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Match {
  matchId: string;
  matchDate: string;
  matchTime: string;
  location: string;
  opponent: string | null;
  matchType: string;
  status: string;
  currentSignups: number;
  minPlayers: number;
  maxPlayers: number;
}

interface SignupPlayer {
  signupId: string;
  player: { userId: string; name: string; preferredPositions: string[] };
  isPriority: boolean;
  signedUpAt: string;
}

interface SignupsResponse {
  match: { matchId: string; matchDate: string; matchTime: string; matchType: string; minPlayers: number; maxPlayers: number };
  signups: SignupPlayer[];
  summary: { totalSignups: number; prioritySignups: number };
}

interface MatchOptimizeResult {
  matchId: string;
  selectedIds: string[];
  deficit: number;
  formation: Record<string, { covered: boolean; required: number; filled: number }>;
}

interface PlayerImpact {
  playerId: string;
  name: string;
  historicalPlayed: number;
  historicalSignups: number;
  batchSignups: number;
  batchSelected: number;
}

interface BatchResult {
  solveTimeMs: number;
  objective: number;
  matches: MatchOptimizeResult[];
  impact: PlayerImpact[];
}

type Step = 'select' | 'configure' | 'optimizing' | 'review';

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function BatchOptimize() {
  const qc = useQueryClient();

  const [step, setStep] = useState<Step>('select');
  const [selectedMatchIds, setSelectedMatchIds] = useState<Set<string>>(new Set());
  const [fairnessWeights, setFairnessWeights] = useState<Record<string, number>>({});
  const [priorityMap, setPriorityMap] = useState<Record<string, boolean>>({});  // signupId → bool
  const [batchResult, setBatchResult] = useState<BatchResult | null>(null);
  const [reviewIdx, setReviewIdx] = useState(0);
  const [reviewSelections, setReviewSelections] = useState<Record<string, Set<string>>>({});
  const [saveStates, setSaveStates] = useState<Record<string, 'idle' | 'saving' | 'saved' | 'error'>>({});
  const [publishStates, setPublishStates] = useState<Record<string, 'idle' | 'publishing' | 'done' | 'error'>>({});
  const [optimizeError, setOptimizeError] = useState('');

  // ── Step 1: fetch signup_closed and optimized matches
  const { data: matchesData, isLoading: matchesLoading } = useQuery({
    queryKey: ['matches', 'batch-eligible'],
    queryFn: () => api.get('/matches/upcoming?status=signup_closed,optimized').then(r => r.data.data),
  });
  const eligibleMatches: Match[] = matchesData?.matches ?? [];

  // ── Step 2: fetch signups for each selected match (parallel)
  const orderedSelected = [...selectedMatchIds];
  const signupQueries = useQueries({
    queries: orderedSelected.map(matchId => ({
      queryKey: ['match-signups', matchId],
      queryFn: () => api.get(`/matches/${matchId}/signups`).then(r => r.data.data as SignupsResponse),
      enabled: step === 'configure' || step === 'review',
    })),
  });

  // Map matchId → SignupsResponse for convenient access
  const signupByMatch: Record<string, SignupsResponse> = {};
  orderedSelected.forEach((id, i) => {
    const d = signupQueries[i]?.data;
    if (d) signupByMatch[id] = d;
  });

  // ── Priority toggle mutation (persists to DB, same as MatchDetail)
  const priorityMutation = useMutation({
    mutationFn: ({ signupId, value }: { signupId: string; value: boolean }) =>
      api.put(`/signups/${signupId}/priority`, { isPriority: value }),
    onSuccess: (_data, { signupId }) => {
      // Invalidate the relevant match's signups query
      const matchId = orderedSelected.find(id =>
        signupByMatch[id]?.signups.some(s => s.signupId === signupId)
      );
      if (matchId) qc.invalidateQueries({ queryKey: ['match-signups', matchId] });
    },
  });

  function togglePriority(signupId: string, currentValue: boolean) {
    const next = !currentValue;
    setPriorityMap(m => ({ ...m, [signupId]: next }));
    priorityMutation.mutate({ signupId, value: next });
  }

  // ── Batch optimize mutation
  // Variables are passed explicitly to mutate() so there are no stale closure issues.
  type MatchConfig = { matchId: string; fairnessWeight: number };
  const optimizeMutation = useMutation({
    mutationFn: (configs: MatchConfig[]) =>
      api.post('/optimize/batch', { matches: configs }).then(r => r.data.data as BatchResult),
  });

  // Drive step transitions reactively so they are never missed by timing/closure issues.
  useEffect(() => {
    if (step !== 'optimizing') return;
    if (optimizeMutation.isSuccess && optimizeMutation.data) {
      const result = optimizeMutation.data;
      setBatchResult(result);
      const initSelections: Record<string, Set<string>> = {};
      (result.matches ?? []).forEach(mr => {
        initSelections[mr.matchId] = new Set(mr.selectedIds ?? []);
      });
      setReviewSelections(initSelections);
      setReviewIdx(0);
      setStep('review');
    } else if (optimizeMutation.isError) {
      const err = optimizeMutation.error as any;
      setOptimizeError(err?.response?.data?.error?.message ?? 'Optimization failed');
      setStep('configure');
    }
  }, [step, optimizeMutation.isSuccess, optimizeMutation.isError, optimizeMutation.data, optimizeMutation.error]);

  // ── Review: toggle a player in the current match
  function toggleReviewPlayer(matchId: string, userId: string) {
    setReviewSelections(prev => {
      const cur = new Set(prev[matchId] ?? []);
      cur.has(userId) ? cur.delete(userId) : cur.add(userId);
      return { ...prev, [matchId]: cur };
    });
    setSaveStates(s => ({ ...s, [matchId]: 'idle' }));
  }

  // ── Save selections for a single review match
  async function saveMatch(matchId: string) {
    setSaveStates(s => ({ ...s, [matchId]: 'saving' }));
    try {
      await api.put(`/matches/${matchId}/selections`, {
        selectedPlayerIds: [...(reviewSelections[matchId] ?? [])],
      });
      qc.invalidateQueries({ queryKey: ['match-selections', matchId] });
      qc.invalidateQueries({ queryKey: ['matches'] });
      setSaveStates(s => ({ ...s, [matchId]: 'saved' }));
    } catch {
      setSaveStates(s => ({ ...s, [matchId]: 'error' }));
    }
  }

  // ── Publish a single review match
  async function publishMatch(matchId: string) {
    setPublishStates(s => ({ ...s, [matchId]: 'publishing' }));
    try {
      await saveMatch(matchId);
      await api.post(`/matches/${matchId}/publish`);
      qc.invalidateQueries({ queryKey: ['matches'] });
      setPublishStates(s => ({ ...s, [matchId]: 'done' }));
    } catch {
      setPublishStates(s => ({ ...s, [matchId]: 'error' }));
    }
  }

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50 boca-page">
      <AppNav backHref="/coach" backLabel="← Matches" />

      <main className={`${step === 'review' ? 'max-w-4xl' : 'max-w-2xl'} mx-auto px-4 py-8 space-y-6`}>

        {/* Progress steps — hidden during review where sidebar nav takes over */}
        <div className={`flex items-center gap-2 text-xs ${step === 'review' ? 'hidden' : ''}`}>
          {(['select', 'configure', 'optimizing', 'review'] as Step[]).map((s, i) => {
            const labels: Record<Step, string> = {
              select: '1. Select', configure: '2. Configure',
              optimizing: '3. Optimizing', review: '4. Review',
            };
            const stepOrder: Record<Step, number> = { select: 0, configure: 1, optimizing: 2, review: 3 };
            const past = stepOrder[step] > stepOrder[s];
            const current = step === s;
            return (
              <span key={s} className="flex items-center gap-2">
                {i > 0 && <span className="text-gray-300">›</span>}
                <span className={`font-medium ${current ? 'text-brand-green' : past ? 'text-gray-400' : 'text-gray-300'}`}>
                  {labels[s]}
                </span>
              </span>
            );
          })}
        </div>

        {/* ── Step 1: Select matches ─────────────────────────────────────── */}
        {step === 'select' && (
          <SelectStep
            matches={eligibleMatches}
            isLoading={matchesLoading}
            selectedMatchIds={selectedMatchIds}
            onToggle={(id) => {
              setSelectedMatchIds(prev => {
                const next = new Set(prev);
                next.has(id) ? next.delete(id) : next.add(id);
                return next;
              });
            }}
            onNext={() => setStep('configure')}
          />
        )}

        {/* ── Step 2: Configure ─────────────────────────────────────────── */}
        {step === 'configure' && (
          <ConfigureStep
            selectedMatchIds={orderedSelected}
            eligibleMatches={eligibleMatches}
            signupByMatch={signupByMatch}
            fairnessWeights={fairnessWeights}
            priorityMap={priorityMap}
            onFairnessChange={(matchId, val) =>
              setFairnessWeights(w => ({ ...w, [matchId]: val }))
            }
            onTogglePriority={togglePriority}
            onBack={() => setStep('select')}
            onOptimize={() => {
              setOptimizeError('');
              optimizeMutation.reset();
              setStep('optimizing');
              optimizeMutation.mutate(
                orderedSelected.map(matchId => ({
                  matchId,
                  fairnessWeight: 1 - (fairnessWeights[matchId] ?? 50) / 100,
                }))
              );
            }}
            optimizeError={optimizeError}
          />
        )}

        {/* ── Step 3: Optimizing ─────────────────────────────────────────── */}
        {step === 'optimizing' && (
          <div className="flex flex-col items-center justify-center py-20 space-y-4">
            <div className="w-10 h-10 border-4 border-brand-green border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-gray-500">Running joint optimization across {orderedSelected.length} matches…</p>
          </div>
        )}

        {/* ── Step 4: Review ─────────────────────────────────────────────── */}
        {step === 'review' && batchResult && (
          <ReviewStep
            batchResult={batchResult}
            orderedMatchIds={orderedSelected}
            signupByMatch={signupByMatch}
            reviewIdx={reviewIdx}
            reviewSelections={reviewSelections}
            saveStates={saveStates}
            publishStates={publishStates}
            onSelectMatch={setReviewIdx}
            onTogglePlayer={toggleReviewPlayer}
            onSave={saveMatch}
            onPublish={publishMatch}
            onReoptimize={() => { optimizeMutation.reset(); setStep('configure'); }}
          />
        )}

      </main>
    </div>
  );
}

// ─── Step 1 component ─────────────────────────────────────────────────────────

function SelectStep({
  matches,
  isLoading,
  selectedMatchIds,
  onToggle,
  onNext,
}: {
  matches: Match[];
  isLoading: boolean;
  selectedMatchIds: Set<string>;
  onToggle: (id: string) => void;
  onNext: () => void;
}) {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-extrabold text-gray-900">Batch optimize</h1>
        <p className="text-sm text-gray-500 mt-1">
          Select the matches you want to optimize together. The optimizer will balance player fairness across all selected matches jointly.
        </p>
      </div>

      {isLoading && <p className="text-sm text-gray-400">Loading matches…</p>}

      {!isLoading && matches.length === 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 text-center">
          <p className="text-sm text-gray-500">No matches ready to optimize right now.</p>
          <p className="text-xs text-gray-400 mt-1">Close signups on a match first, then come back here.</p>
        </div>
      )}

      <div className="space-y-3">
        {matches.map(m => {
          const checked = selectedMatchIds.has(m.matchId);
          const d = new Date(`${m.matchDate}T${m.matchTime}`);
          return (
            <div
              key={m.matchId}
              onClick={() => onToggle(m.matchId)}
              className={`cursor-pointer rounded-xl border p-4 flex items-center gap-4 transition-colors ${
                checked ? 'bg-green-50 border-green-300' : 'bg-white border-gray-200 hover:border-gray-300'
              }`}
            >
              <div className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 ${
                checked ? 'bg-brand-green border-brand-green' : 'border-gray-300'
              }`}>
                {checked && <span className="text-white text-xs font-bold">✓</span>}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-gray-900">
                  {d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
                  {m.opponent && <span className="text-gray-500 font-normal"> · vs {m.opponent}</span>}
                </p>
                <p className="text-sm text-gray-500">
                  {m.matchTime.slice(0, 5)} (meet at {meetingTime(m.matchTime)}) · {formatLocation(m.location, m.matchType)}
                  <span className={`ml-2 text-xs font-medium px-1.5 py-0.5 rounded ${m.matchType === 'futsal' ? 'bg-orange-100 text-orange-700' : 'bg-gray-100 text-gray-500'}`}>
                    {m.matchType}
                  </span>
                </p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {m.currentSignups} signed up · {m.minPlayers}–{m.maxPlayers} needed
                  {m.status === 'optimized' && (
                    <span className="ml-2 text-blue-600 font-medium">· already optimized</span>
                  )}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {selectedMatchIds.size > 0 && (
        <button
          onClick={onNext}
          className="w-full bg-brand-green hover:bg-brand-green-700 text-white font-medium py-2.5 rounded-lg transition-colors"
        >
          Configure {selectedMatchIds.size} match{selectedMatchIds.size > 1 ? 'es' : ''} →
        </button>
      )}
    </div>
  );
}

// ─── Step 2 component ─────────────────────────────────────────────────────────

function ConfigureStep({
  selectedMatchIds,
  eligibleMatches,
  signupByMatch,
  fairnessWeights,
  priorityMap,
  onFairnessChange,
  onTogglePriority,
  onBack,
  onOptimize,
  optimizeError,
}: {
  selectedMatchIds: string[];
  eligibleMatches: Match[];
  signupByMatch: Record<string, SignupsResponse>;
  fairnessWeights: Record<string, number>;
  priorityMap: Record<string, boolean>;
  onFairnessChange: (matchId: string, val: number) => void;
  onTogglePriority: (signupId: string, current: boolean) => void;
  onBack: () => void;
  onOptimize: () => void;
  optimizeError: string;
}) {
  const [expanded, setExpanded] = useState<string>(selectedMatchIds[0] ?? '');

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900">Configure</h1>
          <p className="text-sm text-gray-500 mt-1">Set fairness balance and priority players for each match.</p>
        </div>
        <button onClick={onBack} className="text-sm text-gray-400 hover:text-gray-600">← Back</button>
      </div>

      <div className="space-y-3">
        {selectedMatchIds.map(matchId => {
          const match = eligibleMatches.find(m => m.matchId === matchId);
          const signupsData = signupByMatch[matchId];
          const isExpanded = expanded === matchId;
          const fw = fairnessWeights[matchId] ?? 50;
          const d = match ? new Date(`${match.matchDate}T${match.matchTime}`) : null;

          return (
            <div key={matchId} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              {/* Accordion header */}
              <button
                onClick={() => setExpanded(isExpanded ? '' : matchId)}
                className="w-full px-5 py-4 flex items-center justify-between text-left hover:bg-gray-50 transition-colors"
              >
                <div>
                  <p className="font-semibold text-gray-900">
                    {d ? d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) : matchId}
                    {match?.opponent && <span className="text-gray-500 font-normal"> · vs {match.opponent}</span>}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {match ? `${match.matchTime.slice(0, 5)} · ${signupsData?.summary.totalSignups ?? '…'} signed up` : ''}
                    {' '}· {fw === 50 ? 'Balanced' : fw < 50 ? 'Fairness priority' : 'Positions priority'}
                  </p>
                </div>
                <span className="text-gray-400 text-lg">{isExpanded ? '∧' : '∨'}</span>
              </button>

              {isExpanded && (
                <div className="border-t border-gray-100 px-5 py-4 space-y-4">
                  {/* Fairness slider */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs text-gray-500">
                      <span className="flex items-center gap-1"><Icon name="scale" className="w-3.5 h-3.5" /> Fairness</span>
                      <span className="font-medium text-gray-600">
                        {fw === 50 ? 'Balanced' : fw < 50 ? 'Fairness priority' : 'Positions priority'}
                      </span>
                      <span className="flex items-center gap-1"><Icon name="puzzle" className="w-3.5 h-3.5" /> Positions</span>
                    </div>
                    <input
                      type="range" min={0} max={100} step={10}
                      value={fw}
                      onChange={e => onFairnessChange(matchId, Number(e.target.value))}
                      className="w-full accent-brand-green h-2 cursor-pointer"
                    />
                  </div>

                  {/* Signup list with priority toggles */}
                  {!signupsData && (
                    <p className="text-sm text-gray-400">Loading sign-ups…</p>
                  )}
                  {signupsData && signupsData.signups.length === 0 && (
                    <p className="text-sm text-gray-400">No sign-ups yet.</p>
                  )}
                  {signupsData && signupsData.signups.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                        Signed up — {signupsData.summary.totalSignups}
                      </p>
                      {signupsData.signups.map(({ signupId, player, isPriority: dbPriority }) => {
                        const isPriority = priorityMap[signupId] ?? dbPriority;
                        return (
                          <div key={signupId} className="flex items-center justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium text-gray-900 truncate">{player.name}</p>
                              <div className="flex gap-1 flex-wrap mt-0.5">
                                {player.preferredPositions.map(pos => (
                                  <span key={pos} className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${POS_TAG[pos] ?? 'bg-gray-100 text-gray-500'}`}>
                                    {pos}
                                  </span>
                                ))}
                              </div>
                            </div>
                            <button
                              onClick={() => onTogglePriority(signupId, isPriority)}
                              className={`shrink-0 text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${
                                isPriority
                                  ? 'bg-amber-50 border-amber-300 text-amber-700 hover:bg-amber-100'
                                  : 'bg-gray-50 border-gray-200 text-gray-500 hover:bg-gray-100'
                              }`}
                            >
                              <span className="flex items-center gap-1"><Star filled={isPriority} className="w-3.5 h-3.5" /> Priority</span>
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {optimizeError && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <p className="text-sm text-red-600">{optimizeError}</p>
        </div>
      )}

      <button
        onClick={onOptimize}
        className="w-full bg-brand-green hover:bg-brand-green-700 text-white font-medium py-2.5 rounded-lg transition-colors"
      >
        Run joint optimization →
      </button>
    </div>
  );
}

// ─── Step 4 component ─────────────────────────────────────────────────────────

function ReviewStep({
  batchResult,
  orderedMatchIds,
  signupByMatch,
  reviewIdx,
  reviewSelections,
  saveStates,
  publishStates,
  onSelectMatch,
  onTogglePlayer,
  onSave,
  onPublish,
  onReoptimize,
}: {
  batchResult: BatchResult;
  orderedMatchIds: string[];
  signupByMatch: Record<string, SignupsResponse>;
  reviewIdx: number;
  reviewSelections: Record<string, Set<string>>;
  saveStates: Record<string, 'idle' | 'saving' | 'saved' | 'error'>;
  publishStates: Record<string, 'idle' | 'publishing' | 'done' | 'error'>;
  onSelectMatch: (idx: number) => void;
  onTogglePlayer: (matchId: string, userId: string) => void;
  onSave: (matchId: string) => void;
  onPublish: (matchId: string) => void;
  onReoptimize: () => void;
}) {
  const matchId = orderedMatchIds[reviewIdx];
  const signupsData = signupByMatch[matchId];
  const matchResult = (batchResult.matches ?? []).find(mr => mr.matchId === matchId);
  const ids = reviewSelections[matchId] ?? new Set<string>();
  const saveState = saveStates[matchId] ?? 'idle';
  const publishState = publishStates[matchId] ?? 'idle';

  // Build SelectionPlayer[] for PitchView from signup data + current selections
  const selectionPlayers: SelectionPlayer[] = (signupsData?.signups ?? []).map(s => ({
    player: {
      userId: s.player.userId,
      name: s.player.name,
      preferredPositions: s.player.preferredPositions,
      totalPlayed: 0,
      totalSignups: 0,
    },
    isPriority: s.isPriority,
    isSelected: ids.has(s.player.userId),
    selectedByOptimization: matchResult?.selectedIds?.includes(s.player.userId) ?? false,
    manuallyAdjusted: false,
    optimizationScore: null,
  }));

  const minPlayers = signupsData?.match.minPlayers ?? 0;
  const maxPlayers = signupsData?.match.maxPlayers ?? 0;
  const matchType = signupsData?.match.matchType ?? '7-player';
  const tooFew = ids.size < minPlayers;
  const isDirty = saveState === 'idle' && matchResult?.selectedIds
    ? [...ids].some(id => !matchResult.selectedIds.includes(id)) ||
      matchResult.selectedIds.some(id => !ids.has(id))
    : false;

  const [reviewView, setReviewView] = useState<'selections' | 'balance'>('selections');

  return (
    <div className="flex flex-col sm:flex-row gap-6 sm:gap-8 items-start">

      {/* Sidebar nav — horizontal tab bar on mobile, sidebar on sm+ */}
      <aside className="w-full sm:w-40 shrink-0">
        <div className="flex sm:flex-col gap-1 sm:sticky sm:top-6 sm:pt-1">
          {(['selections', 'balance'] as const).map(v => (
            <button
              key={v}
              onClick={() => setReviewView(v)}
              className={`flex-1 sm:flex-none text-center sm:text-left px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                reviewView === v
                  ? 'bg-brand-green text-white'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              {v === 'selections' ? 'Selections' : 'Player balance'}
            </button>
          ))}
          <div className="sm:pt-4 sm:border-t sm:border-gray-100">
            <button
              onClick={onReoptimize}
              className="w-full text-center sm:text-left px-3 py-2 text-xs text-gray-400 hover:text-gray-600 transition-colors"
            >
              ← Re-optimize
            </button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 min-w-0 space-y-6">

        {/* Header */}
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900">
            {reviewView === 'selections' ? 'Review selections' : 'Player balance'}
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {reviewView === 'selections'
              ? `Walk through each match, adjust if needed, then publish. Solve time: ${(batchResult.solveTimeMs ?? 0).toFixed(0)} ms`
              : 'Sorted by projected play rate — most underrepresented first. Updates as you edit selections on the Selections page.'}
          </p>
        </div>

        {/* Selections view */}
        {reviewView === 'selections' && (
          <div className="space-y-4">

            {/* Match tabs */}
            <div className="flex gap-2 flex-wrap">
              {orderedMatchIds.map((id, i) => {
                const data = signupByMatch[id];
                const d = data ? new Date(`${data.match.matchDate}T${data.match.matchTime}`) : null;
                const published = publishStates[id] === 'done';
                return (
                  <button
                    key={id}
                    onClick={() => onSelectMatch(i)}
                    className={`text-sm font-medium px-3 py-1.5 rounded-lg border transition-colors ${
                      i === reviewIdx
                        ? 'bg-brand-green text-white border-brand-green'
                        : published
                          ? 'bg-purple-50 text-purple-700 border-purple-200'
                          : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    {d ? d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) : id}
                    {published && ' ✓'}
                  </button>
                );
              })}
            </div>

            {/* Current match review panel */}
            {signupsData && (
              <div className="space-y-4">
                {/* Match header + actions */}
                <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="font-semibold text-gray-900">
                        {ids.size} selected
                        <span className={`ml-2 text-sm font-normal ${tooFew ? 'text-red-500' : 'text-gray-500'}`}>
                          (min {minPlayers} · max {maxPlayers})
                        </span>
                      </p>
                      {matchResult && matchResult.deficit > 0 && (
                        <p className="text-xs text-amber-600 mt-0.5">
                          Optimizer deficit: {matchResult.deficit} player{matchResult.deficit > 1 ? 's' : ''} short
                        </p>
                      )}
                    </div>
                    <div className="flex gap-2 shrink-0">
                      {publishState === 'done' ? (
                        <span className="text-sm text-purple-600 font-medium">Published ✓</span>
                      ) : (
                        <>
                          {(isDirty || saveState === 'idle') && (
                            <button
                              onClick={() => onSave(matchId)}
                              disabled={saveState === 'saving'}
                              className="text-sm font-medium px-3 py-2 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-gray-700 transition-colors disabled:opacity-50"
                            >
                              {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved ✓' : 'Save'}
                            </button>
                          )}
                          <button
                            onClick={() => onPublish(matchId)}
                            disabled={publishState === 'publishing' || tooFew}
                            className="bg-brand-green hover:bg-brand-green-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
                          >
                            {publishState === 'publishing' ? 'Publishing…' : 'Publish'}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  {saveState === 'error' && <p className="text-sm text-red-500">Failed to save.</p>}
                  {publishState === 'error' && <p className="text-sm text-red-500">Failed to publish.</p>}
                </div>

                {/* Pitch */}
                {ids.size > 0 && (
                  <PitchView
                    players={selectionPlayers}
                    ids={ids}
                    matchType={matchType}
                    guests={[]}
                  />
                )}

                {/* Player list */}
                <div className="space-y-2">
                  <h2 className="text-sm font-semibold text-gray-700">All signed up</h2>
                  {selectionPlayers.map(({ player, isPriority, selectedByOptimization }) => {
                    const isSelected = ids.has(player.userId);
                    return (
                      <div
                        key={player.userId}
                        onClick={() => onTogglePlayer(matchId, player.userId)}
                        className={`cursor-pointer rounded-xl border p-4 flex items-center gap-4 transition-colors ${
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
                            {selectedByOptimization && <span className="text-xs text-blue-400 shrink-0">optimizer</span>}
                          </div>
                          <div className="flex items-center gap-2 mt-1 flex-wrap">
                            {player.preferredPositions.map(pos => (
                              <span key={pos} className={`text-xs font-medium px-2 py-0.5 rounded-full ${POS_TAG[pos] ?? 'bg-gray-100 text-gray-500'}`}>
                                {pos}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Prev / next match navigation */}
                <div className="flex justify-between pt-2">
                  <button
                    onClick={() => onSelectMatch(reviewIdx - 1)}
                    disabled={reviewIdx === 0}
                    className="text-sm text-gray-500 hover:text-gray-700 disabled:opacity-30"
                  >
                    ← Previous match
                  </button>
                  <button
                    onClick={() => onSelectMatch(reviewIdx + 1)}
                    disabled={reviewIdx === orderedMatchIds.length - 1}
                    className="text-sm text-gray-500 hover:text-gray-700 disabled:opacity-30"
                  >
                    Next match →
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Balance view */}
        {reviewView === 'balance' && (
          <ImpactTable
            impact={batchResult.impact}
            reviewSelections={reviewSelections}
            orderedMatchIds={orderedMatchIds}
            signupByMatch={signupByMatch}
          />
        )}

      </div>
    </div>
  );
}

// ─── Impact table ─────────────────────────────────────────────────────────────

function rateColor(rate: number): string {
  if (rate >= 0.65) return 'bg-green-500';
  if (rate >= 0.4)  return 'bg-amber-400';
  return 'bg-red-400';
}

function rateTextColor(rate: number): string {
  if (rate >= 0.65) return 'text-green-600';
  if (rate >= 0.4)  return 'text-amber-600';
  return 'text-red-500';
}

function RateBar({ played, signups }: { played: number; signups: number }) {
  const rate = signups > 0 ? played / signups : 0;
  return (
    <div className="space-y-0.5">
      <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ${rateColor(rate)}`}
          style={{ width: `${Math.min(100, Math.round(rate * 100))}%` }}
        />
      </div>
      <p className={`text-[11px] tabular-nums font-medium ${rateTextColor(rate)}`}>
        {played}/{signups}
      </p>
    </div>
  );
}

// Projected play-rate bar after the batch, with an up/down trend marker.
function ProjBar({ rate, played, signups, improved, worsened }: {
  rate: number; played: number; signups: number; improved: boolean; worsened: boolean;
}) {
  return (
    <div className="space-y-0.5">
      <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ${rateColor(rate)}`}
          style={{ width: `${Math.min(100, Math.round(rate * 100))}%` }}
        />
      </div>
      <p className={`text-[11px] tabular-nums font-medium ${rateTextColor(rate)}`}>
        {played}/{signups}
        {improved && <span className="ml-1 text-green-500">↑</span>}
        {worsened && <span className="ml-1 text-red-400">↓</span>}
      </p>
    </div>
  );
}

// A single per-match status dot used in both the mobile cards and the table.
function Pip({ signedUp, selected }: { signedUp: boolean; selected: boolean }) {
  return (
    <div
      title={!signedUp ? 'Not signed up' : selected ? 'Selected' : 'Signed up, not selected'}
      className={`w-3 h-3 rounded-full transition-colors ${
        !signedUp
          ? 'bg-gray-100'
          : selected
            ? 'bg-brand-green'
            : 'border-2 border-gray-300 bg-white'
      }`}
    />
  );
}

function ImpactTable({
  impact,
  reviewSelections,
  orderedMatchIds,
  signupByMatch,
}: {
  impact: PlayerImpact[];
  reviewSelections: Record<string, Set<string>>;
  orderedMatchIds: string[];
  signupByMatch: Record<string, SignupsResponse>;
}) {
  // Derive per-player live data from current review selections
  const liveImpact = (impact ?? []).map(p => {
    const batchSelected = orderedMatchIds.filter(mid => reviewSelections[mid]?.has(p.playerId)).length;
    const projPlayed  = p.historicalPlayed + batchSelected;
    const projSignups = p.historicalSignups + p.batchSignups;
    const histRate = p.historicalSignups > 0 ? p.historicalPlayed / p.historicalSignups : 0;
    const projRate = projSignups > 0 ? projPlayed / projSignups : 0;
    // Per-match pip state for this player
    const pips = orderedMatchIds.map(mid => ({
      signedUp: signupByMatch[mid]?.signups.some(s => s.player.userId === p.playerId) ?? false,
      selected: reviewSelections[mid]?.has(p.playerId) ?? false,
    }));
    return { ...p, batchSelected, projPlayed, projSignups, histRate, projRate, pips };
  // Sort by projected rate ascending so most underrepresented players appear first
  }).sort((a, b) => a.projRate - b.projRate);

  // Short date labels for the pip column headers
  const matchLabels = orderedMatchIds.map(id => {
    const d = signupByMatch[id];
    if (!d) return '?';
    const date = new Date(`${d.match.matchDate}T${d.match.matchTime}`);
    return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  });

  return (
    <div className="space-y-3">

      {/* Legend */}
      <div className="flex items-center gap-4 text-xs text-gray-400">
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-brand-green" />
          <span>Selected</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full border-2 border-gray-300" />
          <span>Signed up, not selected</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-gray-100" />
          <span>Not in this match</span>
        </div>
      </div>

      {/* Player list — cards on mobile, scrollable table on sm+ (never
          overflow-hidden: the per-match pip column would be clipped on phones). */}

      {/* Mobile cards */}
      <div className="sm:hidden space-y-3">
        {liveImpact.map(p => {
          const improved = p.projRate > p.histRate + 0.03;
          const worsened = p.projRate < p.histRate - 0.03;
          return (
            <div key={p.playerId} className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
              <p className="font-medium text-gray-900 text-sm truncate">{p.name}</p>

              <div className="flex gap-8">
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-gray-400 mb-1">Season so far</p>
                  <RateBar played={p.historicalPlayed} signups={p.historicalSignups} />
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-gray-400 mb-1">After batch</p>
                  <ProjBar rate={p.projRate} played={p.projPlayed} signups={p.projSignups} improved={improved} worsened={worsened} />
                </div>
              </div>

              <div>
                <p className="text-[10px] uppercase tracking-wide text-gray-400 mb-1.5">This batch</p>
                <div className="flex gap-3 flex-wrap">
                  {p.pips.map((pip, i) => (
                    <div key={i} className="flex flex-col items-center gap-1">
                      <Pip signedUp={pip.signedUp} selected={pip.selected} />
                      <span className="text-[9px] text-gray-400 leading-none text-center">{matchLabels[i]}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Table sm+ */}
      <div className="hidden sm:block bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-xs text-gray-400">
              <th className="text-left px-4 py-2.5 font-medium">Player</th>
              <th className="text-left px-3 py-2.5 font-medium">Season so far</th>
              <th className="px-3 py-2.5 font-medium">
                <div className="flex gap-2 justify-center">
                  {matchLabels.map((label, i) => (
                    <span key={i} className="text-[10px] w-6 text-center leading-tight">{label}</span>
                  ))}
                </div>
              </th>
              <th className="text-left px-3 py-2.5 font-medium">After batch</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {liveImpact.map(p => {
              const improved = p.projRate > p.histRate + 0.03;
              const worsened = p.projRate < p.histRate - 0.03;
              return (
                <tr key={p.playerId} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900 text-sm truncate max-w-[130px]">{p.name}</p>
                  </td>

                  {/* Historical play rate bar */}
                  <td className="px-3 py-3">
                    <RateBar played={p.historicalPlayed} signups={p.historicalSignups} />
                  </td>

                  {/* Batch pip dots: one per match */}
                  <td className="px-3 py-3">
                    <div className="flex gap-2 justify-center">
                      {p.pips.map((pip, i) => (
                        <Pip key={i} signedUp={pip.signedUp} selected={pip.selected} />
                      ))}
                    </div>
                  </td>

                  {/* Projected rate bar after batch */}
                  <td className="px-3 py-3">
                    <ProjBar rate={p.projRate} played={p.projPlayed} signups={p.projSignups} improved={improved} worsened={worsened} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
