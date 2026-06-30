import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Crest, { TIER_META } from './Crest';
import { useCatalog, type EarnedCrest } from '../api/achievements';

// Celebrates newly-earned crests. Diffs the player's current earned set against
// what was last seen (persisted per-user in localStorage) and pops a branded
// modal for anything new. No emoji — the crest itself is the celebration.

const key = (userId: string) => `boca-seen-crests-${userId}`;
const crestKey = (c: EarnedCrest) => `${c.code}:${c.tier}`;

export default function CrestUnlock({ userId, earned }: { userId: string; earned: EarnedCrest[] }) {
  const { data: catalog } = useCatalog();
  const [fresh, setFresh] = useState<EarnedCrest[]>([]);

  useEffect(() => {
    if (!earned.length) return;
    let seen: string[] = [];
    try { seen = JSON.parse(localStorage.getItem(key(userId)) ?? '[]'); } catch { /* ignore */ }
    const seenSet = new Set(seen);
    const allKeys = earned.map(crestKey);

    // First ever load: don't spam — just record the baseline silently.
    if (seen.length === 0) {
      localStorage.setItem(key(userId), JSON.stringify(allKeys));
      return;
    }
    const newOnes = earned.filter(c => !seenSet.has(crestKey(c)));
    if (newOnes.length > 0) setFresh(newOnes);
    localStorage.setItem(key(userId), JSON.stringify(allKeys));
  }, [userId, earned]);

  if (fresh.length === 0 || !catalog) return null;

  const lookup = (code: string) => [...catalog.individual, ...catalog.team].find(c => c.code === code);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setFresh([])}>
      <div className="boca-pop bg-white rounded-2xl border border-gray-200 max-w-sm w-full p-6 text-center" onClick={e => e.stopPropagation()}>
        <p className="text-xs font-semibold uppercase tracking-wider text-brand-green">
          {fresh.length > 1 ? `${fresh.length} new crests` : 'New crest unlocked'}
        </p>
        <div className="flex flex-wrap items-end justify-center gap-4 my-5">
          {fresh.slice(0, 4).map(c => {
            const def = lookup(c.code);
            return (
              <div key={crestKey(c)} className="flex flex-col items-center">
                <Crest glyph={def?.glyph ?? 'medal'} tier={c.tier} size={fresh.length > 1 ? 84 : 120} />
                <p className="mt-2 text-sm font-semibold text-gray-900">{def?.name ?? c.code}</p>
                <p className="text-xs" style={{ color: TIER_META[c.tier].ribbon }}>{TIER_META[c.tier].label}</p>
              </div>
            );
          })}
        </div>
        <button
          onClick={() => setFresh([])}
          className="w-full bg-brand-green text-white rounded-lg py-2.5 text-sm font-semibold hover:bg-brand-green-700 transition-colors"
        >
          Nice!
        </button>
      </div>
    </div>,
    document.body,
  );
}
