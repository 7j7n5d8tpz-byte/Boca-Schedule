import { useState } from 'react';
import { meetingTime } from '../../utils';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import RavenIcon from '../../components/RavenIcon';

interface SelectionPlayer {
  player: { userId: string; name: string; preferredPositions: string[]; totalPlayed: number; totalSignups: number };
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

interface Guest {
  guest_id: string;
  name: string;
  position: string | null;
}

// ─── Pitch visualization ────────────────────────────────────────────────────

const PITCH_X_7: Record<string, number> = {
  GK: 11, DEF: 28, MID: 50, WIN: 70, STR: 88,
};
const FORMATION_MIN_7: Record<string, number> = {
  GK: 1, DEF: 2, WIN: 2, MID: 1, STR: 1,
};

const PITCH_X_FUTSAL: Record<string, number> = {
  GK: 11, MID: 38, WIN: 62, STR: 88,
};
const FORMATION_MIN_FUTSAL: Record<string, number> = {
  GK: 1, WIN: 2, MID: 1, STR: 1,
};

// Tailwind classes must be complete strings so JIT includes them
const TOKEN_STYLES: Record<string, string> = {
  GK:    'bg-yellow-400 ring-yellow-200',
  DEF:   'bg-blue-500   ring-blue-300',
  WIN:   'bg-green-600  ring-green-400',
  MID:   'bg-purple-500 ring-purple-300',
  STR:   'bg-red-500    ring-red-300',
  GUEST: 'bg-gray-400   ring-gray-200',
};

const TOKEN_BG: Record<string, string> = {
  GK: 'bg-yellow-400', DEF: 'bg-blue-500', WIN: 'bg-green-600',
  MID: 'bg-purple-500', STR: 'bg-red-500',
};

const POS_TAG: Record<string, string> = {
  GK:  'bg-yellow-100 text-yellow-700',
  DEF: 'bg-blue-100 text-blue-700',
  WIN: 'bg-green-100 text-green-700',
  MID: 'bg-purple-100 text-purple-700',
  STR: 'bg-red-100 text-red-700',
};

function yPositions(count: number, pos: string): number[] {
  if (count === 0) return [];
  if (count === 1) return [50];
  const wide = pos === 'WIN' || pos === 'DEF';
  if (count === 2) return wide ? [22, 78] : [30, 70];
  if (count === 3) return wide ? [16, 50, 84] : [20, 50, 80];
  if (count === 4) return [13, 37, 63, 87];
  return Array.from({ length: count }, (_, i) => 10 + (i * 80 / (count - 1)));
}

function shortName(full: string): string {
  const parts = full.trim().split(' ');
  const last = parts[parts.length - 1];
  return last.length > 8 ? last.slice(0, 7) + '…' : last;
}

// For futsal display, remap DEF → MID (no DEF position in futsal)
function futsalPositions(prefs: string[]): string[] {
  return prefs.map(p => p === 'DEF' ? 'MID' : p).filter(p => p !== 'DEF');
}

function PitchView({ players, ids, matchType, guests }: { players: SelectionPlayer[]; ids: Set<string>; matchType: string; guests: Guest[] }) {
  const isFutsal = matchType === 'futsal';
  const PITCH_X     = isFutsal ? PITCH_X_FUTSAL     : PITCH_X_7;
  const FORMATION_MIN = isFutsal ? FORMATION_MIN_FUTSAL : FORMATION_MIN_7;

  const selected = players.filter(p => ids.has(p.player.userId));

  const byPos: Record<string, SelectionPlayer[]> = Object.fromEntries(
    Object.keys(PITCH_X).map(pos => [
      pos,
      selected.filter(p => {
        const positions = isFutsal ? futsalPositions(p.player.preferredPositions) : p.player.preferredPositions;
        return positions.includes(pos);
      }),
    ])
  );

  // For futsal: players with no mapped positions are shown at MID (pivot role)
  if (isFutsal) {
    const assignedIds = new Set(Object.values(byPos).flatMap(arr => arr.map(p => p.player.userId)));
    selected.filter(p => !assignedIds.has(p.player.userId)).forEach(p => {
      byPos['MID'] = [...(byPos['MID'] ?? []), p];
    });
  }

  // Guests with a position slot into the pitch; unpositioned guests go to MID
  const guestByPos: Record<string, Guest[]> = Object.fromEntries(Object.keys(PITCH_X).map(p => [p, []]));
  guests.forEach(g => {
    const pos = (g.position && PITCH_X[g.position]) ? (isFutsal && g.position === 'DEF' ? 'MID' : g.position) : 'MID';
    guestByPos[pos] = [...(guestByPos[pos] ?? []), g];
  });

  const allMet = Object.entries(FORMATION_MIN).every(
    ([pos, min]) => byPos[pos].length >= min
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Formation</h2>
        <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${allMet ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
          {allMet ? '✓ All positions covered' : '⚠ Formation incomplete'}
        </span>
      </div>

      <div
        className="relative w-full rounded-xl overflow-hidden select-none"
        style={{ aspectRatio: isFutsal ? '40/20' : '105/68', boxShadow: 'inset 0 0 60px rgba(0,0,0,0.35)' }}
      >
        {isFutsal ? (
          /* Futsal: parquet wood floor */
          <div className="absolute inset-0" style={{
            background: 'repeating-linear-gradient(90deg, #c8954a 0, #c8954a 9.5%, #b8843c 9.5%, #b8843c 19%)',
          }} />
        ) : (
          /* Grass stripes */
          <div className="absolute inset-0" style={{
            background: 'repeating-linear-gradient(90deg, #14532d 0, #14532d 9.5%, #166534 9.5%, #166534 19%)',
          }} />
        )}

        {/* Pitch boundary */}
        <div className="absolute pointer-events-none" style={{
          top: '5%', left: '3.5%', right: '3.5%', bottom: '5%',
          border: '2px solid rgba(255,255,255,0.8)',
        }} />

        {/* Halfway line */}
        <div className="absolute pointer-events-none" style={{
          left: 'calc(50% - 1px)', top: '5%', bottom: '5%',
          width: '2px', background: 'rgba(255,255,255,0.8)',
        }} />

        {/* Centre circle */}
        <div className="absolute pointer-events-none rounded-full" style={{
          top: '50%', left: '50%',
          width: '16.5%', aspectRatio: '1',
          border: '2px solid rgba(255,255,255,0.8)',
          transform: 'translate(-50%, -50%)',
        }} />

        {/* Centre spot */}
        <div className="absolute pointer-events-none rounded-full" style={{
          top: '50%', left: '50%',
          width: '1.3%', aspectRatio: '1',
          background: 'rgba(255,255,255,0.9)',
          transform: 'translate(-50%, -50%)',
        }} />

        {isFutsal ? (
          <>
            {/* Left penalty arc — semicircle centered at the goal line, clipped by overflow:hidden */}
            <div className="absolute pointer-events-none rounded-full" style={{
              top: '50%', left: '3.5%',
              width: '28%', aspectRatio: '1',
              border: '2px solid rgba(255,255,255,0.75)',
              transform: 'translate(-50%, -50%)',
            }} />
            {/* Left penalty spot */}
            <div className="absolute pointer-events-none rounded-full" style={{
              top: '50%', left: '18%',
              width: '1.3%', aspectRatio: '1',
              background: 'rgba(255,255,255,0.85)',
              transform: 'translate(-50%, -50%)',
            }} />
            {/* Right penalty arc */}
            <div className="absolute pointer-events-none rounded-full" style={{
              top: '50%', right: '3.5%',
              width: '28%', aspectRatio: '1',
              border: '2px solid rgba(255,255,255,0.75)',
              transform: 'translate(50%, -50%)',
            }} />
            {/* Right penalty spot */}
            <div className="absolute pointer-events-none rounded-full" style={{
              top: '50%', right: '18%',
              width: '1.3%', aspectRatio: '1',
              background: 'rgba(255,255,255,0.85)',
              transform: 'translate(50%, -50%)',
            }} />
            {/* Left goal */}
            <div className="absolute pointer-events-none" style={{
              top: '38%', left: 0, width: '3.5%', bottom: '38%',
              background: 'rgba(255,255,255,0.12)',
              borderTop: '2px solid rgba(255,255,255,0.9)',
              borderRight: '2px solid rgba(255,255,255,0.9)',
              borderBottom: '2px solid rgba(255,255,255,0.9)',
            }} />
            {/* Right goal */}
            <div className="absolute pointer-events-none" style={{
              top: '38%', right: 0, width: '3.5%', bottom: '38%',
              background: 'rgba(255,255,255,0.12)',
              borderTop: '2px solid rgba(255,255,255,0.9)',
              borderLeft: '2px solid rgba(255,255,255,0.9)',
              borderBottom: '2px solid rgba(255,255,255,0.9)',
            }} />
          </>
        ) : (
          <>
            {/* Left penalty area */}
            <div className="absolute pointer-events-none" style={{
              top: '21%', left: '3.5%', width: '15.5%', bottom: '21%',
              borderTop: '2px solid rgba(255,255,255,0.8)',
              borderRight: '2px solid rgba(255,255,255,0.8)',
              borderBottom: '2px solid rgba(255,255,255,0.8)',
            }} />
            {/* Left goal area */}
            <div className="absolute pointer-events-none" style={{
              top: '37%', left: '3.5%', width: '6%', bottom: '37%',
              borderTop: '2px solid rgba(255,255,255,0.8)',
              borderRight: '2px solid rgba(255,255,255,0.8)',
              borderBottom: '2px solid rgba(255,255,255,0.8)',
            }} />
            {/* Left goal */}
            <div className="absolute pointer-events-none" style={{
              top: '41%', left: 0, width: '3.5%', bottom: '41%',
              background: 'rgba(255,255,255,0.12)',
              borderTop: '2px solid rgba(255,255,255,0.9)',
              borderRight: '2px solid rgba(255,255,255,0.9)',
              borderBottom: '2px solid rgba(255,255,255,0.9)',
            }} />
            {/* Right penalty area */}
            <div className="absolute pointer-events-none" style={{
              top: '21%', right: '3.5%', width: '15.5%', bottom: '21%',
              borderTop: '2px solid rgba(255,255,255,0.8)',
              borderLeft: '2px solid rgba(255,255,255,0.8)',
              borderBottom: '2px solid rgba(255,255,255,0.8)',
            }} />
            {/* Right goal area */}
            <div className="absolute pointer-events-none" style={{
              top: '37%', right: '3.5%', width: '6%', bottom: '37%',
              borderTop: '2px solid rgba(255,255,255,0.8)',
              borderLeft: '2px solid rgba(255,255,255,0.8)',
              borderBottom: '2px solid rgba(255,255,255,0.8)',
            }} />
            {/* Right goal */}
            <div className="absolute pointer-events-none" style={{
              top: '41%', right: 0, width: '3.5%', bottom: '41%',
              background: 'rgba(255,255,255,0.12)',
              borderTop: '2px solid rgba(255,255,255,0.9)',
              borderLeft: '2px solid rgba(255,255,255,0.9)',
              borderBottom: '2px solid rgba(255,255,255,0.9)',
            }} />
            {/* Corner arcs */}
            {([
              { top: '4.5%',    left:  '3%',   borderRadius: '0 0 100% 0' },
              { top: '4.5%',    right: '3%',   borderRadius: '0 0 0 100%' },
              { bottom: '4.5%', left:  '3%',   borderRadius: '0 100% 0 0' },
              { bottom: '4.5%', right: '3%',   borderRadius: '100% 0 0 0' },
            ] as React.CSSProperties[]).map((style, i) => (
              <div key={i} className="absolute pointer-events-none" style={{
                ...style, width: '2.8%', aspectRatio: '1',
                border: '2px solid rgba(255,255,255,0.6)',
              }} />
            ))}
          </>
        )}

        {/* Ghost slots for uncovered positions */}
        {Object.entries(FORMATION_MIN).flatMap(([pos, min]) => {
          if (byPos[pos].length > 0) return [];
          const ys = yPositions(min, pos);
          return ys.map((cy, i) => (
            <div key={`ghost-${pos}-${i}`} className="absolute flex flex-col items-center opacity-35" style={{
              left: `${PITCH_X[pos]}%`, top: `${cy}%`,
              transform: 'translate(-50%, -50%)', width: '10%', zIndex: 5,
            }}>
              <div className="w-8 h-8 rounded-full border-2 border-dashed border-white/70 flex items-center justify-center">
                <span className="text-white text-[8px] font-bold">{pos}</span>
              </div>
              <p className="text-white/50 text-[8px] mt-0.5 text-center">empty</p>
            </div>
          ));
        })}

        {/* Player tokens */}
        {Object.entries(PITCH_X).flatMap(([pos, cx]) => {
          const allAtPos = [...byPos[pos], ...(guestByPos[pos] ?? []).map(g => ({ _guest: g }))];
          const posPlayers = byPos[pos];
          const ys = yPositions(allAtPos.length, pos);
          const met = (posPlayers.length + (guestByPos[pos]?.length ?? 0)) >= FORMATION_MIN[pos];

          return allAtPos.map((item, i) => {
            const isGuest = '_guest' in item;
            if (isGuest) {
              const g = (item as any)._guest as Guest;
              return (
                <div key={`guest-${g.guest_id}`} className="absolute flex flex-col items-center" style={{
                  left: `${cx}%`, top: `${ys[i]}%`,
                  transform: 'translate(-50%, -50%)', width: '11%', zIndex: 10,
                }}>
                  <div className="relative w-8 h-8 rounded-full bg-gray-400 ring-2 ring-gray-200 shadow-xl flex items-center justify-center">
                    <span className="text-white text-[7px] font-extrabold tracking-tight drop-shadow">GST</span>
                  </div>
                  <p className="text-white text-[10px] font-semibold mt-1 text-center leading-none truncate w-full"
                    style={{ textShadow: '0 1px 4px rgba(0,0,0,0.95)' }}>
                    {shortName(g.name)}
                  </p>
                </div>
              );
            }
            const sp = item as SelectionPlayer;
            const displayPos = isFutsal
              ? futsalPositions(sp.player.preferredPositions)
              : sp.player.preferredPositions;
            const others = displayPos.filter(p => p !== pos);
            return (
              <div key={`${pos}-${sp.player.userId}`} className="absolute flex flex-col items-center" style={{
                left: `${cx}%`, top: `${ys[i]}%`,
                transform: 'translate(-50%, -50%)', width: '11%', zIndex: 10,
              }}>
                <div className={`relative w-8 h-8 rounded-full ${TOKEN_STYLES[pos]} ring-2 shadow-xl flex items-center justify-center`}>
                  <span className="text-white text-[8px] font-extrabold tracking-tight drop-shadow">{pos}</span>
                  {sp.isPriority && (
                    <span className="absolute text-yellow-300 font-bold pointer-events-none"
                      style={{ top: '-9px', right: '-2px', fontSize: '13px', textShadow: '0 1px 3px rgba(0,0,0,0.9)' }}>
                      ★
                    </span>
                  )}
                  {!met && (
                    <span className="absolute bottom-[-5px] right-[-5px] w-3.5 h-3.5 rounded-full bg-red-600 border-2 border-white text-white text-[7px] font-bold flex items-center justify-center">
                      !
                    </span>
                  )}
                </div>
                <p className="text-white text-[10px] font-semibold mt-1 text-center leading-none truncate w-full"
                  style={{ textShadow: '0 1px 4px rgba(0,0,0,0.95)' }}>
                  {shortName(sp.player.name)}
                </p>
                {others.length > 0 && (
                  <p className="text-white/55 text-[7px] text-center leading-none mt-px">
                    +{others.join('/')}
                  </p>
                )}
              </div>
            );
          });
        })}
      </div>

      {/* Legend */}
      <div className="flex gap-4 flex-wrap justify-center pt-0.5">
        {Object.keys(PITCH_X).map(pos => (
          <div key={pos} className="flex items-center gap-1.5">
            <div className={`w-2.5 h-2.5 rounded-full ${TOKEN_BG[pos]}`} />
            <span className="text-xs text-gray-400">{pos}</span>
          </div>
        ))}
        <div className="flex items-center gap-1.5">
          <span className="text-yellow-400 text-xs leading-none">★</span>
          <span className="text-xs text-gray-400">Priority</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-gray-400" />
          <span className="text-xs text-gray-400">Guest</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-gray-400 border border-dashed border-gray-300 rounded px-1">empty</span>
          <span className="text-xs text-gray-400">Uncovered slot</span>
        </div>
      </div>
    </div>
  );
}

// ─── Main page ───────────────────────────────────────────────────────────────

export default function Selections() {
  const { matchId } = useParams<{ matchId: string }>();
  const { user, logout } = useAuth();
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
      <nav className="bg-brand-dark border-b border-brand-green/40 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link to={`/coach/matches/${matchId}`} className="text-white/50 hover:text-white/80 text-sm">← Sign-ups</Link>
          <span className="text-white/20">|</span>
          <div className="flex items-center gap-2">
            <RavenIcon className="w-8 h-8" />
            <span className="font-bold text-white text-lg">
              Boca Schedule <span className="text-brand-green-300 text-sm font-normal">Coach</span>
            </span>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-white/70">{user?.name}</span>
          <button onClick={logout} className="text-sm text-white/60 hover:text-white/90">Logout</button>
        </div>
      </nav>

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
