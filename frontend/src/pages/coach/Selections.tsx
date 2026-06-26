import AppNav from '../../components/AppNav';
import { useState } from 'react';
import { meetingTime } from '../../utils';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import { PitchView, POS_TAG, type SelectionPlayer, type Guest } from '../../components/PitchView';
import MatchEditForm from '../../components/MatchEditForm';
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

const POSITION_NAMES: Record<string, string> = {
  GK: 'Goalkeeper', DEF: 'Defender', WIN: 'Winger', MID: 'Midfielder', STR: 'Striker',
};

function fairnessLabel(alpha: number): string {
  if (alpha >= 0.66) return 'Weighted toward fair playing time';
  if (alpha <= 0.34) return 'Weighted toward formation fit';
  return 'Balanced — fairness & formation';
}

// ─── "Why this squad" explainer ────────────────────────────────────────────────

function WhySquad({ opt, minPlayers }: { opt: OptimizationResult; minPlayers: number }) {
  const formation = opt.formation ?? {};
  const slots = Object.entries(formation);

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <span className="font-semibold text-gray-900">Why this squad</span>

      <div className="mt-4 space-y-4">
        {/* Run summary */}
        <div className="flex flex-wrap gap-2">
          <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${opt.deficit === 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
            {opt.deficit === 0 ? `Squad complete · ${opt.selectedCount} selected` : `${opt.deficit} short of the ${minPlayers} minimum`}
          </span>
          <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-gray-100 text-gray-600">
            {fairnessLabel(opt.fairnessWeight)}
          </span>
        </div>

        {/* Formation coverage */}
        {slots.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Formation coverage</p>
            <div className="flex flex-wrap gap-2">
              {slots.map(([pos, slot]) => (
                <span
                  key={pos}
                  className={`text-xs font-medium px-2 py-1 rounded-lg border ${
                    slot.filled >= slot.required ? 'border-green-200 bg-green-50 text-green-700' : 'border-amber-200 bg-amber-50 text-amber-700'
                  }`}
                  title={POSITION_NAMES[pos] ?? pos}
                >
                  {pos} {slot.filled}/{slot.required} {slot.filled >= slot.required ? '✓' : '⚠'}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* How it works */}
        <div className="text-sm text-gray-600 space-y-1.5 border-t border-gray-100 pt-3">
          <p className="font-medium text-gray-700">How the optimizer chooses</p>
          <ul className="list-disc list-inside space-y-1 text-sm text-gray-500">
            <li>Fills your formation (e.g. GK, 2× DEF, 2× WIN…) and reaches at least the minimum squad size.</li>
            <li><span className="text-gray-700 font-medium">Fairness:</span> players who have played fewer games are favoured. Regular sign-ups are rewarded too, but games actually played weigh most (about 4:1).</li>
            <li><span className="text-gray-700 font-medium">Priority (<Star className="inline w-3 h-3 -mt-0.5 text-amber-500" />):</span> players you starred are strongly favoured for a spot.</li>
            <li><span className="text-gray-700 font-medium">Balance:</span> the Fairness↔Positions slider tilts between even playing time and best formation fit. This run was <span className="text-gray-700">{fairnessLabel(opt.fairnessWeight).toLowerCase()}</span>.</li>
          </ul>
          <p className="text-xs text-gray-400 pt-1">Reflects the last optimizer run — any manual changes may differ.</p>
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
  const [showWhy, setShowWhy] = useState(false);
  const [addFilter, setAddFilter] = useState('');
  const [showReoptConfirm, setShowReoptConfirm] = useState(false);

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

  const saveMutation = useMutation({
    mutationFn: (ids: string[]) =>
      api.put(`/matches/${matchId}/selections`, { selectedPlayerIds: ids }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['match-selections', matchId] });
      qc.invalidateQueries({ queryKey: ['matches'] });
      setSaveError('');
      // Re-sync from the server (added non-signups are now signed up); leaves the
      // squad un-dirty while staying in edit mode.
      setSelectedIds(null);
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
  const isPublished = match.status === 'published';
  const date = new Date(`${match.matchDate}T${match.matchTime}`);
  const ids = selectedIds ?? new Set(players.filter(p => p.isSelected).map(p => p.player.userId));
  const selectedCount = ids.size + guests.length;
  const tooFew = selectedCount < match.minPlayers;
  const tooMany = selectedCount > match.maxPlayers;
  const isDirty = players.some(p => p.isSelected !== ids.has(p.player.userId));

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
      <AppNav backHref="/coach" backLabel="Matches" />

      <main className="max-w-2xl mx-auto px-4 py-8 space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-extrabold text-gray-900">
              {date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
            </h1>
            <p className="text-gray-500 mt-1">
              {match.matchTime.slice(0, 5)} (meet at {meetingTime(match.matchTime)}) · {editMode ? 'Editing squad' : 'Squad'}
              {match.opponent && <span className="text-gray-700 font-medium"> · vs {match.opponent}</span>}
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            {editMode ? (
              <button
                onClick={() => { setEditMode(false); setSelectedIds(null); setSaveError(''); }}
                className="text-sm border border-gray-300 text-gray-600 hover:bg-gray-50 font-medium px-3 py-1.5 rounded-lg transition-colors"
              >
                Done
              </button>
            ) : (
              <>
                <button
                  onClick={() => { setSelectedIds(null); setEditMode(true); }}
                  className="text-sm border border-gray-300 text-gray-600 hover:bg-gray-50 font-medium px-3 py-1.5 rounded-lg transition-colors"
                >
                  Edit
                </button>
                <button
                  onClick={() => isPublished ? setShowReoptConfirm(true) : navigate(`/coach/matches/${matchId}`)}
                  className="text-sm border border-gray-300 text-gray-600 hover:bg-gray-50 font-medium px-3 py-1.5 rounded-lg transition-colors"
                >
                  Re-optimize
                </button>
              </>
            )}
          </div>
        </div>

        {/* Re-optimize confirmation (published squads only) */}
        {showReoptConfirm && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 space-y-3">
            <p className="font-semibold text-amber-800">Re-optimize this published squad?</p>
            <p className="text-sm text-amber-700">
              Running the optimizer replaces the current squad and returns the match to “optimized”.
              You'll need to publish again afterwards.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => navigate(`/coach/matches/${matchId}`)}
                className="text-sm bg-brand-green hover:bg-brand-green-700 text-white font-medium px-4 py-2 rounded-lg transition-colors"
              >
                Continue to optimizer
              </button>
              <button
                onClick={() => setShowReoptConfirm(false)}
                className="text-sm border border-gray-300 text-gray-600 hover:bg-gray-50 font-medium px-4 py-2 rounded-lg transition-colors"
              >
                Keep current squad
              </button>
            </div>
          </div>
        )}

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
            {!editMode && !isPublished && (
              <button onClick={() => { setPublishError(''); publishMutation.mutate(); }}
                disabled={publishMutation.isPending || tooFew}
                className="bg-brand-green hover:bg-brand-green-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
                {publishMutation.isPending ? 'Publishing…' : 'Publish'}
              </button>
            )}
          </div>
          {publishError && <p className="text-sm text-red-500">{publishError}</p>}
          {isPublished && !editMode && (
            <p className="text-xs text-gray-500">
              Published — players can see this squad. Use <span className="font-medium">Edit</span> to swap players; anyone added or removed is notified.
            </p>
          )}
        </div>

        {/* Spot claimants — players asking to take an open spot */}
        {claims.length > 0 && (
          <div className="bg-white rounded-xl border border-brand-green/40 p-5 space-y-3">
            <div>
              <h2 className="font-semibold text-gray-900">Spot claimants</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                {claims.length === 1
                  ? 'A player wants to take an open spot. Confirm to add them to the squad.'
                  : `${claims.length} players want an open spot. Confirm one to add them; the rest are declined.`}
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
                    Confirm
                  </button>
                  <button
                    onClick={() => resolveClaimMutation.mutate({ claimId: c.claimId, accept: false })}
                    disabled={resolveClaimMutation.isPending}
                    className="border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
                  >
                    Decline
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
              {showWhy ? 'Hide explanation' : 'Why this squad?'}
            </button>
            {showWhy && <WhySquad opt={match.optimizationResult} minPlayers={match.minPlayers} />}
          </div>
        )}

        {/* Pitch formation view */}
        {(ids.size > 0 || guests.length > 0) && <PitchView players={players} ids={ids} matchType={match.matchType} guests={guests} />}

        {editMode ? (
          <>
            {/* Edit match details */}
            <MatchEditForm
              match={match}
              onSaved={() => {
                qc.invalidateQueries({ queryKey: ['match-selections', matchId] });
                qc.invalidateQueries({ queryKey: ['matches'] });
              }}
              onCancel={() => { setEditMode(false); setSelectedIds(null); }}
            />

            {/* Squad editor */}
            <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
              <div className="flex items-center justify-between gap-4">
                <h2 className="font-semibold text-gray-900">Squad</h2>
                <button
                  onClick={() => { setSaveError(''); saveMutation.mutate([...ids]); }}
                  disabled={saveMutation.isPending || !isDirty || (isPublished && tooFew)}
                  className="bg-brand-green hover:bg-brand-green-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
                >
                  {saveMutation.isPending ? 'Saving…' : isPublished ? 'Save & notify players' : 'Save squad'}
                </button>
              </div>
              {saveError && <p className="text-sm text-red-500">{saveError}</p>}
              {isPublished && <p className="text-xs text-gray-500">Saving emails and notifies anyone added or removed.</p>}
              {isDirty && !isPublished && <p className="text-xs text-amber-600">Unsaved squad changes.</p>}

              {/* Signed-up players */}
              <div className="space-y-2 pt-1">
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Signed up — {signedUpPlayers.length}</h3>
                {signedUpPlayers.length === 0 && <p className="text-sm text-gray-400">No players signed up.</p>}
                {signedUpPlayers.map(p => <PlayerRow key={p.player.userId} p={p} interactive />)}
              </div>

              {/* Add players who didn't sign up */}
              <div className="space-y-2 pt-2 border-t border-gray-100">
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Add another player</h3>
                <p className="text-xs text-gray-400 -mt-1">Players who didn't sign up. Adding one signs them up for this match.</p>
                <input
                  type="text"
                  placeholder="Search players…"
                  value={addFilter}
                  onChange={e => setAddFilter(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green"
                />
                {otherPlayers.length === 0 && <p className="text-sm text-gray-400">No matching players.</p>}
                {otherPlayers.map(p => <PlayerRow key={p.player.userId} p={p} interactive />)}
              </div>
            </div>

            {/* Guest players (external, non-registered) */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-gray-700">Guest players</h2>
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
          </>
        ) : (
          <>
            {/* Read-only squad list */}
            <div className="space-y-2">
              <h2 className="text-sm font-semibold text-gray-700">Signed-up players — {signedUpPlayers.length}</h2>
              {signedUpPlayers.length === 0 && <p className="text-sm text-gray-400">No players signed up.</p>}
              {signedUpPlayers.map(p => <PlayerRow key={p.player.userId} p={p} interactive={false} />)}
            </div>

            {/* Guests (read-only) */}
            {guests.length > 0 && (
              <div className="space-y-2">
                <h2 className="text-sm font-semibold text-gray-700">Guest players</h2>
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
