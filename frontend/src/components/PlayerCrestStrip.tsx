import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { useCatalog, type PlayerAchievements } from '../api/achievements';
import { TIER_META, tierRank } from './Crest';
import CrestButton from './CrestButton';

// The player's earned crests (highest tier per group). Tapping a crest opens
// the badge detail via onOpen; linkToAchievements shows the owner's shortcut
// to their Achievements page. Note the achievement season is club-wide (all
// competitions, calendar year), so it may span more matches than any
// season/type filters around it.
export default function PlayerCrestStrip({ playerId, onOpen, linkToAchievements = false }: {
  playerId: string;
  onOpen?: (code: string) => void;
  linkToAchievements?: boolean;
}) {
  const { data: catalog } = useCatalog();
  const { data } = useQuery<PlayerAchievements>({
    queryKey: ['achievements', playerId],
    queryFn: () => api.get(`/players/${playerId}/achievements`).then(r => r.data.data),
  });
  if (!catalog?.individual || !data?.groups) return null;

  const lookup = (code: string) => [...catalog.individual, ...catalog.team].find(c => c.code === code);
  const earned = data.groups
    .filter(g => g.highestTier)
    .sort((a, b) => tierRank(b.highestTier!) - tierRank(a.highestTier!));
  if (earned.length === 0) return null;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 className="text-sm font-semibold text-gray-700">Crests · {data.seasonYear} (all competitions)</h2>
        {linkToAchievements && (
          <Link to="/achievements" className="text-xs font-medium text-brand-green hover:text-brand-green-700 transition-colors shrink-0">
            All achievements →
          </Link>
        )}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-3">
        {earned.map(g => (
          <div key={g.code} className="flex flex-col items-center text-center w-16">
            <CrestButton
              glyph={lookup(g.code)?.glyph ?? 'medal'}
              tier={g.highestTier!}
              size={48}
              label={`${lookup(g.code)?.name ?? g.code} · ${TIER_META[g.highestTier!].label}`}
              onClick={onOpen ? () => onOpen(g.code) : undefined}
            />
            <p className="mt-1 text-[10px] font-medium text-gray-700 leading-tight">{lookup(g.code)?.name ?? g.code}</p>
          </div>
        ))}
      </div>
      {onOpen && <p className="mt-3 text-[11px] text-gray-400">Tap a crest to see what it takes.</p>}
    </div>
  );
}
