import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from './client';
import { tierRank, type Tier, type GlyphName } from '../components/Crest';

// Shared types + helpers for the gamification UI. The catalog is served by the
// backend (single source of truth in backend/src/lib/achievements.ts).

export interface CatalogEntry {
  code: string;
  name: string;
  description: string;
  category: 'performance' | 'reliability' | 'team';
  glyph: GlyphName;
  unit: string;
  isStreak: boolean;
  tiers: { tier: Tier; threshold: number }[];
}

export interface Catalog {
  individual: CatalogEntry[];
  team: CatalogEntry[];
  tiers: Tier[];
}

export interface EarnedCrest {
  code: string;
  tier: Tier;
  progress: number | null;
  earnedAt: string | null;
}

export interface GroupProgress {
  code: string;
  value: number | null;
  highestTier: Tier | null;
  nextThreshold: number | null;
}

type StreakType = 'attendance' | 'scoring' | 'clean_sheet' | 'win' | 'no_withdrawal';

export interface StreakResult {
  type: StreakType;
  current: number;
  record: number;
  currentStartDate: string | null;
}

export interface PlayerAchievements {
  player: { userId: string; name: string; avatarUrl: string | null };
  seasonYear: number;
  earned: EarnedCrest[];
  groups: GroupProgress[];
  streaks: StreakResult[];
}

export interface TeamWall {
  seasonYear: number;
  players: { playerId: string; name: string; avatarUrl: string | null; crests: EarnedCrest[] }[];
  team: { earned: EarnedCrest[]; groups: GroupProgress[] };
}

// ─── Overall rank ─────────────────────────────────────────────────────────────
// A player's overall tier aggregates their best crest in each group: each group
// contributes (tierRank + 1) points for its highest tier. Climbing any ladder, or
// reaching a new group, nudges the overall rank up.

const OVERALL_LADDER: { tier: Tier; points: number }[] = [
  { tier: 'bronze', points: 1 },
  { tier: 'silver', points: 8 },
  { tier: 'gold', points: 16 },
  { tier: 'platinum', points: 24 },
  { tier: 'diamond', points: 32 },
  { tier: 'champion', points: 40 },
  { tier: 'legend', points: 50 },
];

export function overallPoints(crests: { code: string; tier: Tier }[]): number {
  const best = new Map<string, number>();
  for (const c of crests) {
    const r = tierRank(c.tier);
    if (!best.has(c.code) || r > best.get(c.code)!) best.set(c.code, r);
  }
  let pts = 0;
  for (const r of best.values()) pts += r + 1;
  return pts;
}

export function overallRank(points: number): { tier: Tier | null; floor: number; next: { tier: Tier; points: number } | null } {
  let tier: Tier | null = null;
  let floor = 0;
  let next: { tier: Tier; points: number } | null = OVERALL_LADDER[0];
  for (let i = 0; i < OVERALL_LADDER.length; i++) {
    if (points >= OVERALL_LADDER[i].points) {
      tier = OVERALL_LADDER[i].tier;
      floor = OVERALL_LADDER[i].points;
      next = OVERALL_LADDER[i + 1] ?? null;
    }
  }
  return { tier, floor, next };
}

/**
 * Catalog prose in the reader's language.
 *
 * Crest `name`s stay as the backend sends them — they're branded, English by
 * design. Descriptions and units are translated by code, falling back to the
 * server's own text so a crest added to the backend catalog still renders
 * sensibly before it has a translation.
 */
export function useCatalogText() {
  const { t } = useTranslation();
  return {
    description: (e: { code: string; description: string }) =>
      t(`achievementDefs.${e.code}.description`, { defaultValue: e.description }),
    unit: (e: { code: string; unit: string }) =>
      t(`achievementDefs.${e.code}.unit`, { defaultValue: e.unit }),
  };
}

/** Shared catalog query — cached so the page and the unlock modal reuse it. */
export function useCatalog() {
  return useQuery<Catalog>({
    queryKey: ['ach-catalog'],
    queryFn: () => api.get('/achievements').then(r => r.data.data),
    staleTime: 60 * 60 * 1000, // catalog is static
  });
}

/** Team-wall query — shared by the wall view and the badge-detail modal. */
export function useTeamWall() {
  return useQuery<TeamWall>({
    queryKey: ['ach-team-wall'],
    queryFn: () => api.get('/players/achievements/team-wall').then(r => r.data.data),
  });
}
