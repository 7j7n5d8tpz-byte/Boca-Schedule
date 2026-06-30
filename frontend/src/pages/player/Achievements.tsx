import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import AppNav from '../../components/AppNav';
import Avatar from '../../components/Avatar';
import Crest, { TIERS, TIER_META, tierRank, type Tier } from '../../components/Crest';
import CrestUnlock from '../../components/CrestUnlock';
import BadgeDetailModal from '../../components/BadgeDetailModal';
import PlayerCrestsModal from '../../components/PlayerCrestsModal';
import RankBar from '../../components/RankBar';
import { CardListSkeleton } from '../../components/Skeleton';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import {
  useCatalog, useTeamWall, overallPoints, overallRank,
  type CatalogEntry, type PlayerAchievements, type EarnedCrest, type GroupProgress, type StreakResult, type TeamWall,
} from '../../api/achievements';

type RankedPlayer = TeamWall['players'][number] & { points: number; tier: Tier | null };

// A clickable crest with a hover tooltip — used across the wall + leaderboard.
function CrestButton({ glyph, tier, size, label, onClick, locked }: {
  glyph: CatalogEntry['glyph']; tier: Tier; size: number; label: string; onClick?: () => void; locked?: boolean;
}) {
  return (
    <button type="button" onClick={onClick} className="relative group shrink-0" aria-label={label}>
      <Crest glyph={glyph} tier={tier} size={size} showRibbon={false} locked={locked} />
      <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 bottom-full mb-1 z-10 hidden group-hover:block whitespace-nowrap rounded bg-gray-900 text-white text-[11px] px-2 py-1 shadow-lg">
        {label}
      </span>
    </button>
  );
}

// ─── Overall rank hero ──────────────────────────────────────────────────────

function OverallHero({ earned }: { earned: EarnedCrest[] }) {
  const points = overallPoints(earned);
  const { tier } = overallRank(points);

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-center gap-4">
      <Crest glyph="medal" tier={tier ?? 'bronze'} locked={!tier} size={84} />
      <div className="min-w-0 flex-1">
        <p className="text-xs text-gray-500">Overall rank</p>
        <p className="text-xl font-bold text-gray-900 mb-2">{tier ? TIER_META[tier].label : 'Unranked'}</p>
        <RankBar points={points} />
        <p className="text-[11px] text-gray-400 mt-1.5">{earned.length} crest tiers earned</p>
      </div>
    </div>
  );
}

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

// ─── Streaks ────────────────────────────────────────────────────────────────

// Each streak card IS its crest — same name on the card and in the modal it opens.
function StreakCard({ entry, streak, group, onOpen }: {
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
          <p className="text-[11px] text-gray-400 truncate">{entry.description}</p>
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
  const streakByType = new Map(data.streaks.map(s => [s.type, s]));
  const earnedCode = (code: string) => !!groupByCode.get(code)?.highestTier;
  // Catalog code → live streak type. The streak crest and its live run are one thing.
  const typeForCode: Record<string, StreakResult['type']> = {
    attendance_streak: 'attendance', scoring_streak: 'scoring', win_streak: 'win',
  };
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
      <OverallHero earned={data.earned} />

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

      <section>
        <h2 className="text-sm font-semibold text-gray-700 mb-1 mt-5">Streaks</h2>
        <p className="text-xs text-gray-400 mb-2">Live runs — keep them going. Your best run banks a permanent crest.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {catalog.individual.filter(c => c.isStreak).map(entry => {
            const streak = streakByType.get(typeForCode[entry.code]);
            if (!streak) return null;
            return (
              <StreakCard
                key={entry.code}
                entry={entry}
                streak={streak}
                group={groupByCode.get(entry.code)}
                onOpen={onOpen}
              />
            );
          })}
        </div>
      </section>
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
      <p className="text-xs text-gray-400">Players ranked by overall tier · {data.seasonYear} — tap a player for their crests.</p>

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

      {drillPlayer && <PlayerCrestsModal player={drillPlayer} onClose={() => setDrillPlayer(null)} />}
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
