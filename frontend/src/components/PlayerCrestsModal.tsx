import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import Crest, { TIER_META, tierRank } from './Crest';
import Avatar from './Avatar';
import RankBar from './RankBar';
import CrestButton from './CrestButton';
import { useCatalog, overallPoints, overallRank, type EarnedCrest } from '../api/achievements';

interface WallPlayer {
  playerId: string;
  name: string;
  avatarUrl: string | null;
  crests: EarnedCrest[];
}

// Drill-down from the team wall: one player's full crest collection. Tapping a
// crest opens the badge detail (via onOpenCrest); "View full profile" jumps to
// the player's hub page.
export default function PlayerCrestsModal({ player, onClose, onOpenCrest }: {
  player: WallPlayer;
  onClose: () => void;
  onOpenCrest?: (code: string) => void;
}) {
  const { data: catalog } = useCatalog();
  const lookup = (code: string) => catalog && [...catalog.individual, ...catalog.team].find(c => c.code === code);

  const points = overallPoints(player.crests);
  const { tier } = overallRank(points);
  const crests = [...player.crests].sort((a, b) => tierRank(b.tier) - tierRank(a.tier));

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="boca-pop bg-white rounded-2xl border border-gray-200 max-w-sm w-full max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="p-5 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <Avatar src={player.avatarUrl} name={player.name} size={48} />
            <div className="min-w-0 flex-1">
              <p className="text-base font-bold text-gray-900 truncate">{player.name}</p>
              <p className="text-xs" style={{ color: tier ? TIER_META[tier].ribbon : '#9ca3af' }}>
                {tier ? `${TIER_META[tier].label} rank` : 'Unranked'} · {player.crests.length} crests
              </p>
            </div>
            <Crest glyph="medal" tier={tier ?? 'bronze'} locked={!tier} size={48} showRibbon={false} />
          </div>
          <div className="mt-3"><RankBar points={points} /></div>
        </div>

        <div className="p-4">
          {crests.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">No crests earned yet this season.</p>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-3">
                {crests.map(c => (
                  <div key={`${c.code}:${c.tier}`} className="flex flex-col items-center text-center">
                    <CrestButton
                      glyph={lookup(c.code)?.glyph ?? 'medal'}
                      tier={c.tier}
                      size={56}
                      label={`${lookup(c.code)?.name ?? c.code} · ${TIER_META[c.tier].label}`}
                      onClick={onOpenCrest ? () => onOpenCrest(c.code) : undefined}
                    />
                    <p className="mt-1 text-[11px] font-medium text-gray-800 leading-tight">{lookup(c.code)?.name ?? c.code}</p>
                    <p className="text-[10px]" style={{ color: TIER_META[c.tier].ribbon }}>{TIER_META[c.tier].label}</p>
                  </div>
                ))}
              </div>
              {onOpenCrest && <p className="mt-3 text-[11px] text-gray-400 text-center">Tap a crest to see what it takes.</p>}
            </>
          )}
        </div>

        <div className="p-4 pt-0 space-y-2">
          <Link
            to={`/players/${player.playerId}`}
            state={{ from: '/achievements', fromLabel: 'Achievements' }}
            onClick={onClose}
            className="block w-full text-center bg-brand-green text-white rounded-lg py-2.5 text-sm font-semibold hover:bg-brand-green-700 transition-colors"
          >
            View full profile
          </Link>
          <button onClick={onClose} className="w-full bg-gray-100 text-gray-700 rounded-lg py-2.5 text-sm font-semibold hover:bg-gray-200 transition-colors">
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
