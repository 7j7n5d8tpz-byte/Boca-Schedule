import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import AppNav from '../../components/AppNav';
import Avatar from '../../components/Avatar';
import Crest, { TIERS, TIER_META, tierRank, type Tier } from '../../components/Crest';
import CrestUnlock from '../../components/CrestUnlock';
import BadgeDetailModal from '../../components/BadgeDetailModal';
import PlayerCrestsModal from '../../components/PlayerCrestsModal';
import CrestButton from '../../components/CrestButton';
import RankBar from '../../components/RankBar';
import { CardListSkeleton } from '../../components/Skeleton';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import {
  useCatalog, useTeamWall, overallPoints, overallRank,
  type CatalogEntry, type PlayerAchievements, type EarnedCrest, type GroupProgress, type TeamWall,
} from '../../api/achievements';

type RankedPlayer = TeamWall['players'][number] & { points: number; tier: Tier | null };

// ─── Crest card (own page) ──────────────────────────────────────────────────

function CrestCard({ entry, group, onOpen }: {
  entry: CatalogEntry; group?: GroupProgress; onOpen: (code: string) => void;
}) {
  const highest = group?.highestTier ?? null;
  const value = group?.value ?? 0;
  const next = group?.nextThreshold ?? null;
  const displayTier: Tier = highest ?? 'bronze';
  const locked = !highest;
  const pct = next ? Math.min(100, Math.round((value / next) * 100)) : 100;

  return (
    <button type="button" onClick={() => onOpen(entry.code)} className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col items-center text-center lift cursor-pointer">
      <Crest glyph={entry.glyph} tier={displayTier} locked={locked} size={92} />
      <p className="mt-2 text-sm font-semibold text-gray-900">{entry.name}</p>
      <p className="text-xs text-gray-400 mt-0.5">{entry.description}</p>
      <div className="w-full mt-3">
        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <div className="h-full bg-brand-green rounded-full transition-all" style={{ width: `${pct}%` }} />
        </div>
        <p className="text-[11px] text-gray-500 mt-1.5">
          {next === null
            ? `Maxed — ${value} ${entry.unit}`
            : `${value} / ${next} ${entry.unit}`}
        </p>
      </div>
    </button>
  );
}

// ─── Mine tab ───────────────────────────────────────────────────────────────

function MyCrests({ userId, onOpen }: { userId: string; onOpen: (code: string) => void }) {
  const { data: catalog } = useCatalog();
  const [showLocked, setShowLocked] = useState(false);
  const { data, isLoading } = useQuery<PlayerAchievements>({
    queryKey: ['achievements', userId],
    queryFn: () => api.get(`/players/${userId}/achievements`).then(r => r.data.data),
  });

  if (isLoading || !catalog || !data) return <CardListSkeleton />;

  const groupByCode = new Map(data.groups.map(g => [g.code, g]));
  const earnedCode = (code: string) => !!groupByCode.get(code)?.highestTier;
  const categories: { key: CatalogEntry['category']; label: string }[] = [
    { key: 'performance', label: 'On the pitch' },
    { key: 'reliability', label: 'Reliability' },
  ];

  // Badge grids cover season totals only; streak crests live in the Streaks section.
  const badgeDefs = catalog.individual.filter(c => !c.isStreak);
  const lockedCount = badgeDefs.filter(c => !earnedCode(c.code)).length;

  return (
    <>
      <CrestUnlock userId={userId} earned={data.earned} />
      {/* Overall rank, streaks and season stats live on the player hub — this
          tab is the full catalog: progress per crest and locked ones to chase. */}
      <Link
        to={`/players/${userId}`}
        state={{ from: '/achievements', fromLabel: 'Achievements' }}
        className="bg-white rounded-xl border border-gray-200 hover:border-brand-green p-4 flex items-center justify-between gap-3 transition-colors group lift"
      >
        <div>
          <p className="text-sm font-semibold text-gray-900">Your profile</p>
          <p className="text-xs text-gray-400 mt-0.5">Overall rank, streaks &amp; season stats</p>
        </div>
        <span className="text-gray-300 group-hover:text-brand-green transition-colors text-lg">→</span>
      </Link>
      <p className="text-xs text-gray-400">
        Season {data.seasonYear} — every competition counts (calendar year).
      </p>

      {categories.map(cat => {
        const all = badgeDefs.filter(c => c.category === cat.key);
        const entries = showLocked ? all : all.filter(c => earnedCode(c.code));
        if (entries.length === 0) return null;
        return (
          <section key={cat.key}>
            <h2 className="text-sm font-semibold text-gray-700 mb-2 mt-5">{cat.label}</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {entries.map(entry => (
                <CrestCard key={entry.code} entry={entry} group={groupByCode.get(entry.code)} onOpen={onOpen} />
              ))}
            </div>
          </section>
        );
      })}

      {lockedCount > 0 && (
        <button
          onClick={() => setShowLocked(v => !v)}
          className="w-full text-sm font-medium text-gray-500 hover:text-brand-green border border-dashed border-gray-300 rounded-lg py-2.5 transition-colors"
        >
          {showLocked ? 'Hide locked crests' : `Show ${lockedCount} locked crest${lockedCount > 1 ? 's' : ''} to chase`}
        </button>
      )}
    </>
  );
}

// ─── Team wall tab ──────────────────────────────────────────────────────────

function TeamWallView({ onOpen }: { onOpen: (code: string) => void }) {
  const { data: catalog } = useCatalog();
  const { data, isLoading } = useTeamWall();
  const [drillPlayer, setDrillPlayer] = useState<RankedPlayer | null>(null);

  if (isLoading || !catalog || !data) return <CardListSkeleton />;

  const lookup = (code: string) => [...catalog.individual, ...catalog.team].find(c => c.code === code);
  const glyphFor = (code: string) => lookup(code)?.glyph ?? 'medal';
  const nameFor = (code: string) => lookup(code)?.name ?? code;

  // Rank each player, then bucket by overall tier (highest tier first, unranked last).
  const ranked = data.players.map(p => {
    const points = overallPoints(p.crests);
    return { ...p, points, tier: overallRank(points).tier };
  });
  const order: (Tier | null)[] = [...TIERS].reverse();
  order.push(null); // Unranked
  const buckets = order
    .map(tier => ({
      tier,
      players: ranked
        .filter(p => p.tier === tier)
        .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name)),
    }))
    .filter(b => b.players.length > 0);

  // Team trophies: highest tier per team code.
  const bestTeam = new Map<string, EarnedCrest>();
  for (const e of data.team.earned) {
    const cur = bestTeam.get(e.code);
    if (!cur || tierRank(e.tier) > tierRank(cur.tier)) bestTeam.set(e.code, e);
  }

  return (
    <>
      <p className="text-xs text-gray-400">Players ranked by overall tier · {data.seasonYear} season, all competitions — tap a player for their crests.</p>

      {buckets.map(({ tier, players }) => (
        <section key={tier ?? 'unranked'}>
          <div className="flex items-center gap-2 mb-2 mt-4">
            <Crest glyph="medal" tier={tier ?? 'bronze'} locked={!tier} size={28} showRibbon={false} />
            <h2 className="text-sm font-bold" style={{ color: tier ? TIER_META[tier].ribbon : '#9ca3af' }}>
              {tier ? TIER_META[tier].label : 'Unranked'}
            </h2>
            <span className="text-xs text-gray-400">· {players.length}</span>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
            {players.map(p => (
              <button
                key={p.playerId}
                type="button"
                onClick={() => setDrillPlayer(p)}
                className="w-full flex items-center gap-3 p-3 text-left hover:bg-gray-50 transition-colors"
              >
                <Avatar src={p.avatarUrl} name={p.name} size={36} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-gray-900 truncate">{p.name}</p>
                    <span className="text-[11px] text-gray-400 shrink-0 ml-auto">{p.crests.length} crests</span>
                  </div>
                  <div className="mt-1.5"><RankBar points={p.points} compact /></div>
                </div>
                <span className="text-gray-300 text-lg shrink-0">→</span>
              </button>
            ))}
          </div>
        </section>
      ))}
      {buckets.length === 0 && <p className="text-sm text-gray-400 text-center py-8">No crests earned yet this season.</p>}

      {bestTeam.size > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-gray-700 mb-1 mt-6">Team trophies</h2>
          <p className="text-xs text-gray-400 mb-2">Won by the whole squad this season — tap a crest to see what it takes.</p>
          <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-wrap gap-5 justify-center">
            {[...bestTeam.values()].map(e => (
              <div key={e.code} className="flex flex-col items-center">
                <CrestButton glyph={glyphFor(e.code)} tier={e.tier} size={64} label={`${nameFor(e.code)} · ${TIER_META[e.tier].label}`} onClick={() => onOpen(e.code)} />
                <p className="mt-1.5 text-xs font-semibold text-gray-900">{nameFor(e.code)}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {drillPlayer && <PlayerCrestsModal player={drillPlayer} onClose={() => setDrillPlayer(null)} onOpenCrest={onOpen} />}
    </>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function Achievements() {
  const { user } = useAuth();
  const [tab, setTab] = useState<'mine' | 'team'>('mine');
  const [modalCode, setModalCode] = useState<string | null>(null);

  return (
    <div className="min-h-screen bg-gray-50 boca-page">
      <AppNav backHref="/dashboard" backLabel="Dashboard" />
      <main className="max-w-3xl mx-auto px-4 py-6 space-y-4">
        <h1 className="text-2xl font-bold text-gray-900">Achievements</h1>

        <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
          {(['mine', 'team'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                tab === t ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {t === 'mine' ? 'My crests' : 'Team wall'}
            </button>
          ))}
        </div>

        {tab === 'mine'
          ? (user ? <MyCrests userId={user.userId} onOpen={setModalCode} /> : null)
          : <TeamWallView onOpen={setModalCode} />}
      </main>

      {modalCode && <BadgeDetailModal code={modalCode} onClose={() => setModalCode(null)} />}
    </div>
  );
}
