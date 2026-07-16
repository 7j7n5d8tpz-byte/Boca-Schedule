import Crest, { TIER_META } from '../Crest';
import type { CatalogEntry, GroupProgress, StreakResult } from '../../api/achievements';

// Each streak card IS its crest — same name on the card and in the modal it opens.
// group.value / nextThreshold may be null (redacted for teammates on private
// counts); the ?? fallbacks below keep the card rendering sensibly.
export default function StreakCard({ entry, streak, group, onOpen }: {
  entry: CatalogEntry; streak: StreakResult; group?: GroupProgress; onOpen: (code: string) => void;
}) {
  const active = streak.current > 0;
  const hot = streak.current >= 4;
  const record = group?.value ?? streak.record;
  const next = group?.nextThreshold ?? null;
  const pct = next ? Math.min(100, Math.round((record / next) * 100)) : 100;
  const tier = group?.highestTier ?? null;

  return (
    <button
      type="button"
      onClick={() => onOpen(entry.code)}
      className={`text-left bg-white rounded-xl border p-4 lift cursor-pointer ${
        hot ? 'border-brand-red/50 ring-1 ring-brand-red/20' : active ? 'border-brand-green/40' : 'border-gray-200'
      }`}
    >
      <div className="flex items-center gap-3">
        <Crest glyph={entry.glyph} tier={tier ?? 'bronze'} locked={!tier} size={52} showRibbon={false} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-gray-900 truncate">{entry.name}</span>
            {hot
              ? <span className="ml-auto text-[10px] font-bold text-brand-red uppercase tracking-wide shrink-0">On fire</span>
              : active ? <span className="ml-auto text-[10px] font-semibold text-brand-green uppercase tracking-wide shrink-0">Active</span> : null}
          </div>
          <p className="text-[11px] text-gray-400 leading-snug">{entry.description}</p>
          <p className="text-3xl font-bold font-numeric text-gray-900 mt-1 leading-none">
            {streak.current}<span className="text-sm font-medium text-gray-400"> now</span>
          </p>
          <p className="text-[11px] text-gray-400 mt-1">Best this season: {record}{tier ? ` · ${TIER_META[tier].label}` : ''}</p>
        </div>
      </div>
      {next !== null && (
        <div className="mt-3">
          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-brand-green rounded-full" style={{ width: `${pct}%` }} />
          </div>
          <p className="text-[10px] text-gray-400 mt-1">{record} / {next} to next crest tier</p>
        </div>
      )}
    </button>
  );
}
