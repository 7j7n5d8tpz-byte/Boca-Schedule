import Crest, { TIER_META, TIERS, tierRank, type Tier } from './Crest';
import Avatar from './Avatar';
import { useCatalog, useTeamWall } from '../api/achievements';

// "Who else has this?" — opened by clicking any crest. Explains the badge (glyph,
// description, tier ladder) and lists every player who has earned it, by tier.

export default function BadgeDetailModal({ code, onClose }: { code: string; onClose: () => void }) {
  const { data: catalog } = useCatalog();
  const { data: wall } = useTeamWall();

  const entry = catalog && [...catalog.individual, ...catalog.team].find(c => c.code === code);
  if (!entry) return null;

  const isTeam = entry.category === 'team';

  // Everyone who holds this badge, with their highest tier — from the team wall.
  const holders = (wall?.players ?? [])
    .map(p => {
      const c = p.crests.find(x => x.code === code);
      return c ? { playerId: p.playerId, name: p.name, avatarUrl: p.avatarUrl, tier: c.tier } : null;
    })
    .filter((x): x is { playerId: string; name: string; avatarUrl: string | null; tier: Tier } => x !== null)
    .sort((a, b) => tierRank(b.tier) - tierRank(a.tier));

  // Representative crest = highest tier anyone holds (else bronze, greyed).
  const topTier: Tier | null = holders[0]?.tier ?? (isTeam ? wall?.team.earned.filter(e => e.code === code).sort((a, b) => tierRank(b.tier) - tierRank(a.tier))[0]?.tier ?? null : null);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="boca-pop bg-white rounded-2xl border border-gray-200 max-w-sm w-full max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="p-5 text-center border-b border-gray-100">
          <div className="flex justify-center">
            <Crest glyph={entry.glyph} tier={topTier ?? 'bronze'} locked={!topTier} size={104} showRibbon={false} />
          </div>
          <p className="mt-2 text-base font-bold text-gray-900">{entry.name}</p>
          <p className="text-xs text-gray-500 mt-0.5">{entry.description}</p>

          {/* Tier ladder thresholds */}
          <div className="flex flex-wrap justify-center gap-1.5 mt-3">
            {entry.tiers.map(t => (
              <span
                key={t.tier}
                className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
                style={{ background: `${TIER_META[t.tier].to}1a`, color: TIER_META[t.tier].ribbon }}
                title={TIER_META[t.tier].label}
              >
                {t.threshold}
              </span>
            ))}
          </div>
          <p className="text-[10px] text-gray-400 mt-1">
            {entry.isStreak ? `${entry.unit} for the best-run crest` : `${entry.unit} needed per tier`} ({TIERS.length} tiers)
          </p>
        </div>

        <div className="p-4">
          <p className="text-xs font-semibold text-gray-700 mb-2">
            {isTeam ? 'A whole-squad badge' : holders.length > 0 ? `Earned by ${holders.length} player${holders.length > 1 ? 's' : ''}` : 'Not earned yet'}
          </p>
          <div className="space-y-1.5">
            {holders.map(h => (
              <div key={h.playerId} className="flex items-center gap-2.5">
                <Avatar src={h.avatarUrl} name={h.name} size={28} />
                <span className="text-sm text-gray-800 flex-1 min-w-0 truncate">{h.name}</span>
                <Crest glyph={entry.glyph} tier={h.tier} size={24} showRibbon={false} />
                <span className="text-xs font-medium w-16 text-right" style={{ color: TIER_META[h.tier].ribbon }}>
                  {TIER_META[h.tier].label}
                </span>
              </div>
            ))}
            {!isTeam && holders.length === 0 && (
              <p className="text-sm text-gray-400 text-center py-3">Be the first to earn this one.</p>
            )}
          </div>
        </div>

        <div className="p-4 pt-0">
          <button onClick={onClose} className="w-full bg-gray-100 text-gray-700 rounded-lg py-2.5 text-sm font-semibold hover:bg-gray-200 transition-colors">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
