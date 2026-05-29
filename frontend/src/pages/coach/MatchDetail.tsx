import AppNav from '../../components/AppNav';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import LocationPicker, { encodeLocation, decodeLocation, formatLocation } from '../../components/LocationPicker';
import { meetingTime } from '../../utils';

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
  matchType: string;
  matchCategory: string;
  serieLetter: string | null;
  status: string;
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

const POS_COLOR: Record<string, string> = {
  GK:  'bg-yellow-100 text-yellow-700',
  DEF: 'bg-blue-100 text-blue-700',
  WIN: 'bg-green-100 text-green-700',
  MID: 'bg-purple-100 text-purple-700',
  STR: 'bg-red-100 text-red-700',
};

export default function MatchDetail() {
  const { matchId } = useParams<{ matchId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [priorityMap, setPriorityMap] = useState<Record<string, boolean>>({});
  const [optimizeError, setOptimizeError] = useState('');
  const [fairnessWeight, setFairnessWeight] = useState(50); // 0 = positions, 100 = fairness
  const [showEdit, setShowEdit] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [editFields, setEditFields] = useState({ matchDate: '', matchTime: '', opponent: '', matchCategory: 'serie' as 'serie' | 'pokal', serieLetter: 'A', signupOpenDate: '', signupCloseDate: '', minPlayers: 0, maxPlayers: 0 });
  const [editVenue, setEditVenue] = useState('');
  const [editCourt, setEditCourt] = useState('');

  const { data, isLoading } = useQuery<SignupsResponse>({
    queryKey: ['match-signups', matchId],
    queryFn: () => api.get(`/matches/${matchId}/signups`).then(r => r.data.data),
  });

  const priorityMutation = useMutation({
    mutationFn: ({ signupId, value }: { signupId: string; value: boolean }) =>
      api.put(`/signups/${signupId}/priority`, { isPriority: value }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['match-signups', matchId] }),
  });

  const editMutation = useMutation({
    mutationFn: (fields: { matchDate: string; matchTime: string; location: string; opponent: string; matchCategory: 'serie' | 'pokal'; serieLetter: string; signupOpenDate: string; signupCloseDate: string; minPlayers: number; maxPlayers: number }) =>
      api.put(`/matches/${matchId}`, {
        matchDate: fields.matchDate,
        matchTime: fields.matchTime,
        location: fields.location,
        opponent: fields.opponent.trim() || null,
        matchCategory: fields.matchCategory,
        serieLetter: fields.matchCategory === 'serie' ? fields.serieLetter : null,
        signupOpenDate: fields.signupOpenDate + 'T00:00:00Z',
        signupCloseDate: fields.signupCloseDate + 'T20:00:00Z',
        minPlayers: fields.minPlayers,
        maxPlayers: fields.maxPlayers,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['match-signups', matchId] });
      qc.invalidateQueries({ queryKey: ['matches'] });
      setShowEdit(false);
    },
  });

  const statusMutation = useMutation({
    mutationFn: (status: string) => api.put(`/matches/${matchId}`, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['match-signups', matchId] });
      qc.invalidateQueries({ queryKey: ['matches'] });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: () => api.put(`/matches/${matchId}`, { status: 'cancelled' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['matches'] });
      navigate('/coach');
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
      setOptimizeError(err.response?.data?.error?.message ?? 'Optimization failed');
    },
  });

  function openEdit() {
    const { venue, court } = decodeLocation(match.location);
    setEditVenue(venue);
    setEditCourt(court);
    setEditFields({
      matchDate: match.matchDate,
      matchTime: match.matchTime.slice(0, 5),
      opponent: match.opponent ?? '',
      matchCategory: (match.matchCategory as 'serie' | 'pokal') ?? 'serie',
      serieLetter: match.serieLetter ?? 'A',
      signupOpenDate: match.signupOpenDate?.slice(0, 10) ?? '',
      signupCloseDate: match.signupCloseDate?.slice(0, 10) ?? '',
      minPlayers: match.minPlayers,
      maxPlayers: match.maxPlayers,
    });
    setShowEdit(true);
  }

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
    return <div className="min-h-screen bg-gray-50 boca-page flex items-center justify-center text-gray-400">Loading…</div>;
  }

  if (!data) {
    return <div className="min-h-screen bg-gray-50 boca-page flex items-center justify-center text-red-500">Match not found</div>;
  }

  const { match, signups, summary } = data;
  const date = new Date(`${match.matchDate}T${match.matchTime}`);

  return (
    <div className="min-h-screen bg-gray-50 boca-page">
      <AppNav backHref="/coach" backLabel="← Matches" />

      <main className="max-w-2xl mx-auto px-4 py-8 space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              {date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
            </h1>
            <p className="text-gray-500 mt-1">
              {match.matchTime.slice(0, 5)} (meet at {meetingTime(match.matchTime)}) · {formatLocation(match.location, match.matchType)}
              {match.opponent && <span className="text-gray-700 font-medium"> vs {match.opponent}</span>}
              {' '}· {summary.totalSignups} signed up
              {summary.prioritySignups > 0 && (
                <span className="ml-2 text-amber-600 font-medium">· {summary.prioritySignups} priority</span>
              )}
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            <button
              onClick={openEdit}
              className="text-sm border border-gray-300 text-gray-600 hover:bg-gray-50 font-medium px-3 py-1.5 rounded-lg transition-colors"
            >
              Edit
            </button>
            <button
              onClick={() => setShowCancelConfirm(true)}
              className="text-sm border border-red-200 text-red-600 hover:bg-red-50 font-medium px-3 py-1.5 rounded-lg transition-colors"
            >
              Cancel match
            </button>
          </div>
        </div>

        {/* Status controls */}
        {match.status === 'draft' && (
          <div className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 flex items-center justify-between gap-4">
            <p className="text-sm text-gray-500">Signups are not open yet — players cannot see or join this match.</p>
            <button
              onClick={() => statusMutation.mutate('signup_open')}
              disabled={statusMutation.isPending}
              className="shrink-0 bg-brand-green hover:bg-brand-green-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              Open signups
            </button>
          </div>
        )}
        {match.status === 'signup_open' && (
          <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 flex items-center justify-between gap-4">
            <p className="text-sm text-green-700">Signups are open — players can join this match.</p>
            <button
              onClick={() => statusMutation.mutate('signup_closed')}
              disabled={statusMutation.isPending}
              className="shrink-0 border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50 text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              Close signups
            </button>
          </div>
        )}
        {match.status === 'signup_closed' && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-xl px-4 py-3 flex items-center justify-between gap-4">
            <p className="text-sm text-yellow-700">Signups are closed — ready to run the optimizer.</p>
            <button
              onClick={() => statusMutation.mutate('signup_open')}
              disabled={statusMutation.isPending}
              className="shrink-0 border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50 text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              Reopen signups
            </button>
          </div>
        )}
        {match.status === 'optimized' && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 flex items-center justify-between gap-4">
            <p className="text-sm text-blue-700">Optimizer has selected players — review before publishing.</p>
            <div className="flex gap-2 shrink-0">
              <Link
                to={`/coach/matches/${matchId}/selections`}
                className="border border-gray-300 text-gray-600 hover:bg-gray-50 text-sm font-medium px-4 py-2 rounded-lg transition-colors"
              >
                View selections
              </Link>
              <button
                onClick={() => statusMutation.mutate('published')}
                disabled={statusMutation.isPending}
                className="bg-brand-green hover:bg-brand-green-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
              >
                Publish to players
              </button>
            </div>
          </div>
        )}
        {match.status === 'published' && (
          <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 flex items-center justify-between gap-4">
            <p className="text-sm text-green-700">Match is published — players can see the selection.</p>
            <Link
              to={`/coach/matches/${matchId}/selections`}
              className="shrink-0 border border-gray-300 text-gray-600 hover:bg-gray-50 text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              View selections
            </Link>
          </div>
        )}
        {match.status === 'completed' && (
          <div className="bg-gray-100 border border-gray-200 rounded-xl px-4 py-3">
            <p className="text-sm text-gray-500">This match is completed.</p>
          </div>
        )}

        {/* Edit form */}
        {showEdit && (
          <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
            <h2 className="font-semibold text-gray-900">Edit match details</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Date</label>
                <input
                  type="date"
                  value={editFields.matchDate}
                  onChange={e => setEditFields(f => ({ ...f, matchDate: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Time</label>
                <input
                  type="time"
                  value={editFields.matchTime}
                  onChange={e => setEditFields(f => ({ ...f, matchTime: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Min players</label>
                <input
                  type="number"
                  min={1}
                  value={editFields.minPlayers}
                  onChange={e => setEditFields(f => ({ ...f, minPlayers: parseInt(e.target.value) || 0 }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Max players</label>
                <input
                  type="number"
                  min={1}
                  value={editFields.maxPlayers}
                  onChange={e => setEditFields(f => ({ ...f, maxPlayers: parseInt(e.target.value) || 0 }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  Venue <span className="text-gray-400 font-normal">
                    · {match.matchType === 'futsal' ? 'Hall (optional)' : 'Court (optional)'}
                  </span>
                </label>
                <LocationPicker
                  venue={editVenue}
                  court={editCourt}
                  onVenueChange={setEditVenue}
                  onCourtChange={setEditCourt}
                  matchType={match.matchType}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Opponent <span className="text-gray-400">(optional)</span></label>
                <input
                  type="text"
                  placeholder="e.g. FC Vesterbro"
                  value={editFields.opponent}
                  onChange={e => setEditFields(f => ({ ...f, opponent: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Category</label>
                <select
                  value={editFields.matchCategory}
                  onChange={e => setEditFields(f => ({ ...f, matchCategory: e.target.value as 'serie' | 'pokal' }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green"
                >
                  <option value="serie">Serie</option>
                  <option value="pokal">Pokal</option>
                </select>
              </div>
              {editFields.matchCategory === 'serie' && (
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Serie letter</label>
                  <select
                    value={editFields.serieLetter}
                    onChange={e => setEditFields(f => ({ ...f, serieLetter: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green"
                  >
                    {['A','B','C','D','E','F'].map(l => (
                      <option key={l} value={l}>{l}</option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Signup opens</label>
                <input
                  type="date"
                  value={editFields.signupOpenDate}
                  onChange={e => setEditFields(f => ({ ...f, signupOpenDate: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Signup deadline</label>
                <input
                  type="date"
                  value={editFields.signupCloseDate}
                  onChange={e => setEditFields(f => ({ ...f, signupCloseDate: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green"
                />
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowEdit(false)}
                className="text-sm border border-gray-300 text-gray-600 hover:bg-gray-50 font-medium px-4 py-2 rounded-lg transition-colors"
              >
                Discard
              </button>
              <button
                onClick={() => editMutation.mutate({ ...editFields, location: encodeLocation(editVenue, editCourt), matchCategory: editFields.matchCategory, serieLetter: editFields.serieLetter })}
                disabled={editMutation.isPending}
                className="text-sm bg-brand-green hover:bg-brand-green-700 disabled:opacity-50 text-white font-medium px-4 py-2 rounded-lg transition-colors"
              >
                {editMutation.isPending ? 'Saving…' : 'Save changes'}
              </button>
            </div>
            {editMutation.isError && (
              <p className="text-sm text-red-500">Failed to save changes.</p>
            )}
          </div>
        )}

        {/* Cancel confirmation */}
        {showCancelConfirm && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-5 space-y-3">
            <p className="font-semibold text-red-800">Cancel this match?</p>
            <p className="text-sm text-red-600">This cannot be undone. The match will be marked as cancelled and removed from the active list.</p>
            <div className="flex gap-2">
              <button
                onClick={() => cancelMutation.mutate()}
                disabled={cancelMutation.isPending}
                className="text-sm bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-medium px-4 py-2 rounded-lg transition-colors"
              >
                {cancelMutation.isPending ? 'Cancelling…' : 'Yes, cancel match'}
              </button>
              <button
                onClick={() => setShowCancelConfirm(false)}
                className="text-sm border border-gray-300 text-gray-600 hover:bg-gray-50 font-medium px-4 py-2 rounded-lg transition-colors"
              >
                Keep match
              </button>
            </div>
          </div>
        )}

        {/* Optimize card */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="font-semibold text-gray-900">Run optimizer</p>
              <p className="text-sm text-gray-500 mt-0.5">
                Selects the best {match.minPlayers}–{match.maxPlayers} players based on fairness and formation fit.
              </p>
            </div>
            <button
              onClick={() => { setOptimizeError(''); optimizeMutation.mutate(); }}
              disabled={optimizeMutation.isPending || signups.length === 0}
              className="shrink-0 bg-brand-green hover:bg-brand-green-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              {optimizeMutation.isPending ? 'Optimizing…' : 'Optimize'}
            </button>
          </div>

          {/* Weight lever */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-gray-500">
              <span>⚖️ Fairness</span>
              <span className="font-medium text-gray-600">
                {fairnessWeight === 50 ? 'Balanced' : fairnessWeight < 50 ? 'Fairness priority' : 'Positions priority'}
              </span>
              <span>🧩 Positions</span>
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
              Balances playing-time fairness against formation fit.
            </p>
          </div>

          {optimizeError && <p className="text-sm text-red-500">{optimizeError}</p>}
        </div>

        {/* Sign-ups list */}
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
            Signed up — {summary.totalSignups}
          </h2>
          {signups.length === 0 && (
            <p className="text-sm text-gray-400">No players signed up yet.</p>
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
                  {isPriority ? '★ Priority' : '☆ Priority'}
                </button>
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}
