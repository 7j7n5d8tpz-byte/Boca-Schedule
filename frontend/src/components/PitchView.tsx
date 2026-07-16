import React from 'react';
import { Star } from './Icon';

export interface SelectionPlayer {
  player: {
    userId: string;
    name: string;
    preferredPositions: string[];
    totalPlayed: number;
    totalSignups: number;
  };
  isPriority: boolean;
  isSelected: boolean;
  isSignedUp?: boolean;
  selectedByOptimization: boolean;
  manuallyAdjusted: boolean;
  optimizationScore: number | null;
}

export interface Guest {
  guest_id: string;
  name: string;
  position: string | null;
}

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

export const POS_TAG: Record<string, string> = {
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

export function PitchView({
  players,
  ids,
  matchType,
  guests,
}: {
  players: SelectionPlayer[];
  ids: Set<string>;
  matchType: string;
  guests: Guest[];
}) {
  const isFutsal = matchType === 'futsal';
  const PITCH_X      = isFutsal ? PITCH_X_FUTSAL      : PITCH_X_7;
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

  if (isFutsal) {
    const assignedIds = new Set(Object.values(byPos).flatMap(arr => arr.map(p => p.player.userId)));
    selected.filter(p => !assignedIds.has(p.player.userId)).forEach(p => {
      byPos['MID'] = [...(byPos['MID'] ?? []), p];
    });
  }

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
        <h2 className="text-sm font-semibold text-gray-700">Formation</h2>
        <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${allMet ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
          {allMet ? '✓ All positions covered' : '⚠ Formation incomplete'}
        </span>
      </div>

      <div
        className="relative w-full rounded-xl overflow-hidden select-none"
        style={{ aspectRatio: isFutsal ? '40/20' : '105/68', boxShadow: 'inset 0 0 60px rgba(0,0,0,0.35)' }}
      >
        {isFutsal ? (
          <div className="absolute inset-0" style={{
            background: 'repeating-linear-gradient(90deg, #c8954a 0, #c8954a 9.5%, #b8843c 9.5%, #b8843c 19%)',
          }} />
        ) : (
          <div className="absolute inset-0" style={{
            background: 'repeating-linear-gradient(90deg, #14532d 0, #14532d 9.5%, #166534 9.5%, #166534 19%)',
          }} />
        )}

        <div className="absolute pointer-events-none" style={{
          top: '5%', left: '3.5%', right: '3.5%', bottom: '5%',
          border: '2px solid rgba(255,255,255,0.8)',
        }} />
        <div className="absolute pointer-events-none" style={{
          left: 'calc(50% - 1px)', top: '5%', bottom: '5%',
          width: '2px', background: 'rgba(255,255,255,0.8)',
        }} />
        <div className="absolute pointer-events-none rounded-full" style={{
          top: '50%', left: '50%',
          width: '16.5%', aspectRatio: '1',
          border: '2px solid rgba(255,255,255,0.8)',
          transform: 'translate(-50%, -50%)',
        }} />
        <div className="absolute pointer-events-none rounded-full" style={{
          top: '50%', left: '50%',
          width: '1.3%', aspectRatio: '1',
          background: 'rgba(255,255,255,0.9)',
          transform: 'translate(-50%, -50%)',
        }} />

        {isFutsal ? (
          <>
            <div className="absolute pointer-events-none rounded-full" style={{
              top: '50%', left: '3.5%', width: '28%', aspectRatio: '1',
              border: '2px solid rgba(255,255,255,0.75)',
              transform: 'translate(-50%, -50%)',
            }} />
            <div className="absolute pointer-events-none rounded-full" style={{
              top: '50%', left: '18%', width: '1.3%', aspectRatio: '1',
              background: 'rgba(255,255,255,0.85)',
              transform: 'translate(-50%, -50%)',
            }} />
            <div className="absolute pointer-events-none rounded-full" style={{
              top: '50%', right: '3.5%', width: '28%', aspectRatio: '1',
              border: '2px solid rgba(255,255,255,0.75)',
              transform: 'translate(50%, -50%)',
            }} />
            <div className="absolute pointer-events-none rounded-full" style={{
              top: '50%', right: '18%', width: '1.3%', aspectRatio: '1',
              background: 'rgba(255,255,255,0.85)',
              transform: 'translate(50%, -50%)',
            }} />
            <div className="absolute pointer-events-none" style={{
              top: '38%', left: 0, width: '3.5%', bottom: '38%',
              background: 'rgba(255,255,255,0.12)',
              borderTop: '2px solid rgba(255,255,255,0.9)',
              borderRight: '2px solid rgba(255,255,255,0.9)',
              borderBottom: '2px solid rgba(255,255,255,0.9)',
            }} />
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
            <div className="absolute pointer-events-none" style={{
              top: '21%', left: '3.5%', width: '15.5%', bottom: '21%',
              borderTop: '2px solid rgba(255,255,255,0.8)',
              borderRight: '2px solid rgba(255,255,255,0.8)',
              borderBottom: '2px solid rgba(255,255,255,0.8)',
            }} />
            <div className="absolute pointer-events-none" style={{
              top: '37%', left: '3.5%', width: '6%', bottom: '37%',
              borderTop: '2px solid rgba(255,255,255,0.8)',
              borderRight: '2px solid rgba(255,255,255,0.8)',
              borderBottom: '2px solid rgba(255,255,255,0.8)',
            }} />
            <div className="absolute pointer-events-none" style={{
              top: '41%', left: 0, width: '3.5%', bottom: '41%',
              background: 'rgba(255,255,255,0.12)',
              borderTop: '2px solid rgba(255,255,255,0.9)',
              borderRight: '2px solid rgba(255,255,255,0.9)',
              borderBottom: '2px solid rgba(255,255,255,0.9)',
            }} />
            <div className="absolute pointer-events-none" style={{
              top: '21%', right: '3.5%', width: '15.5%', bottom: '21%',
              borderTop: '2px solid rgba(255,255,255,0.8)',
              borderLeft: '2px solid rgba(255,255,255,0.8)',
              borderBottom: '2px solid rgba(255,255,255,0.8)',
            }} />
            <div className="absolute pointer-events-none" style={{
              top: '37%', right: '3.5%', width: '6%', bottom: '37%',
              borderTop: '2px solid rgba(255,255,255,0.8)',
              borderLeft: '2px solid rgba(255,255,255,0.8)',
              borderBottom: '2px solid rgba(255,255,255,0.8)',
            }} />
            <div className="absolute pointer-events-none" style={{
              top: '41%', right: 0, width: '3.5%', bottom: '41%',
              background: 'rgba(255,255,255,0.12)',
              borderTop: '2px solid rgba(255,255,255,0.9)',
              borderLeft: '2px solid rgba(255,255,255,0.9)',
              borderBottom: '2px solid rgba(255,255,255,0.9)',
            }} />
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
                    <span className="absolute text-yellow-300 pointer-events-none"
                      style={{ top: '-9px', right: '-3px', filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.9))' }}>
                      <Star className="w-3 h-3" />
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
          <Star className="w-3 h-3 text-yellow-400" />
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
