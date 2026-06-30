import { overallRank } from '../api/achievements';
import { TIER_META } from './Crest';

// XP-style progress bar toward the next overall tier. `points` is the player's
// overall XP (sum of best crest per group); the fill shows progress through the
// current tier, coloured by that tier.
// The fill is intentionally one colour everywhere (Boca green) so a bar always
// just means "progress" — the tier itself is shown by the crest / caption, not
// encoded in the colour.
export default function RankBar({ points, compact = false }: { points: number; compact?: boolean }) {
  const { next, floor } = overallRank(points);
  const span = next ? next.points - floor : 1;
  const pct = next ? Math.min(100, Math.round(((points - floor) / span) * 100)) : 100;
  const caption = next ? `${next.points - points} XP to ${TIER_META[next.tier].label}` : 'Max rank';

  if (compact) {
    return (
      <div className="flex items-center gap-2 w-full">
        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden flex-1">
          <div className="h-full bg-brand-green rounded-full" style={{ width: `${pct}%` }} />
        </div>
        <span className="text-[10px] text-gray-400 shrink-0 whitespace-nowrap">{caption}</span>
      </div>
    );
  }

  return (
    <div>
      <div className="flex justify-between text-[11px] mb-1">
        <span className="font-semibold text-brand-green">{points} XP</span>
        <span className="text-gray-400">{caption}</span>
      </div>
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className="h-full bg-brand-green rounded-full transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
