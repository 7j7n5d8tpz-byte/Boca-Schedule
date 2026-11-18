import { useEffect, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { BottomSheet } from '@astryxdesign/core/BottomSheet';
import { List, ListItem } from '@astryxdesign/core/List';
import { api } from '../api/client';
import { overallPoints, overallRank, type PlayerAchievements } from '../api/achievements';
import Crest, { TIER_META } from './Crest';
import Glyph, { type GlyphId } from './NavGlyph';

// The phone "More" sheet: a player card (identity + score) on top, then the
// management views and the account actions as grouped rows. Desktop keeps the
// plain avatar dropdown in the top bar.

export interface SheetRow {
  id: string;
  label: string;
  description?: string;
  glyph: GlyphId;
  isCurrent?: boolean;
  isDestructive?: boolean;
  onSelect: () => void;
}

interface MoreSheetProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string | undefined;
  name: string;
  roleLabel: string | null;
  avatar: ReactNode;
  onOpenProfile: () => void;
  manageRows: SheetRow[];
  accountRows: SheetRow[];
}

export default function MoreSheet({
  isOpen, onOpenChange, userId, name, roleLabel, avatar, onOpenProfile, manageRows, accountRows,
}: MoreSheetProps) {
  const { t } = useTranslation();

  // Astryx BottomSheet keeps its children in the DOM while closed. Mount the
  // content only while the sheet is open (plus its exit animation), so a closed
  // sheet holds no duplicate text — e.g. the profile page's rank and rating.
  const [isMounted, setIsMounted] = useState(isOpen);
  if (isOpen && !isMounted) setIsMounted(true);
  useEffect(() => {
    if (isOpen) return;
    const id = setTimeout(() => setIsMounted(false), 500);
    return () => clearTimeout(id);
  }, [isOpen]);

  const group = (header: string, rows: SheetRow[]) => rows.length > 0 && (
    <List
      header={<span className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-500 pt-3">{header}</span>}
      hasDividers
    >
      {rows.map(row => (
        <ListItem
          key={row.id}
          label={<span className={row.isDestructive ? 'text-brand-red' : undefined}>{row.label}</span>}
          description={row.description}
          isSelected={row.isCurrent}
          onClick={() => { onOpenChange(false); row.onSelect(); }}
          startContent={
            <span
              className={`w-8 h-8 rounded-[10px] grid place-items-center shrink-0 ${
                row.isDestructive
                  ? 'bg-brand-red-50 text-brand-red'
                  : row.isCurrent ? 'bg-brand-green text-white' : 'bg-brand-green-50 text-brand-green'
              }`}
            >
              <Glyph id={row.glyph} className="w-[17px] h-[17px]" />
            </span>
          }
          endContent={
            row.isCurrent
              ? <span className="text-[10px] font-semibold text-brand-green bg-white border border-brand-green-100 rounded-full px-2 py-px">{t('nav.here')}</span>
              : row.isDestructive ? null : <Chevron className="w-4 h-4 text-gray-400" />
          }
        />
      ))}
    </List>
  );

  return (
    <BottomSheet isOpen={isOpen} onOpenChange={onOpenChange} label={t('nav.more')} height="hug">
      {isMounted && <>
      <button
        type="button"
        onClick={() => { onOpenChange(false); onOpenProfile(); }}
        className="relative w-full overflow-hidden rounded-2xl bg-brand-dark text-white text-left pl-6 pr-3.5 py-3.5 flex flex-col gap-3 active:scale-[0.99] transition-transform focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-green"
      >
        {/* Kit stripe down the left edge, crest watermark top-right (kept upright). */}
        <span className="absolute inset-y-0 left-0 flex" aria-hidden>
          <span className="w-1 bg-brand-green" />
          <span className="w-1 bg-brand-red" />
          <span className="w-1 bg-brand-green" />
        </span>
        <img src="/boca-logo.png" alt="" aria-hidden className="absolute -right-6 -top-5 w-32 h-32 opacity-10 pointer-events-none" />

        <span className="relative flex items-center gap-3 w-full">
          <span className="rounded-full ring-2 ring-white shrink-0">{avatar}</span>
          <span className="min-w-0 flex-1">
            <span className="block font-display font-extrabold text-base leading-tight truncate">{name}</span>
            <span className="block text-xs text-white/70 mt-px">{t('nav.viewProfile')}</span>
            {roleLabel && (
              <span className="inline-block mt-1.5 text-[10px] font-semibold uppercase tracking-wide rounded-full px-2 py-0.5 bg-brand-green">{roleLabel}</span>
            )}
          </span>
          <Chevron className="w-4 h-4 text-white/45 shrink-0" />
        </span>

        {userId && <ScoreStrip userId={userId} enabled={isOpen} />}
      </button>

      {group(t('nav.groupManage'), manageRows)}
      {group(t('nav.groupAccount'), accountRows)}
      </>}
    </BottomSheet>
  );
}

// Overall rank + XP + career rating — the same numbers as the profile header,
// so the cache is shared with the player hub (same query keys).
function ScoreStrip({ userId, enabled }: { userId: string; enabled: boolean }) {
  const { t } = useTranslation();
  const achievements = useQuery<PlayerAchievements>({
    queryKey: ['achievements', userId],
    queryFn: () => api.get(`/players/${userId}/achievements`).then(r => r.data.data),
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const stats = useQuery<{ seasonStats?: { career_rating?: number } }>({
    queryKey: ['player-stats', userId, null, 'all'],
    queryFn: () => api.get(`/players/${userId}/statistics`).then(r => r.data.data),
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
  });

  const loading = achievements.isLoading || stats.isLoading;
  const earned = achievements.data?.earned ?? null;
  const rating = stats.data?.seasonStats?.career_rating ?? 0;

  if (loading) {
    return (
      <span className="relative flex items-center gap-3 w-full pt-3 border-t border-white/10" aria-hidden>
        <span className="w-9 h-10 rounded-lg bg-white/10 animate-pulse shrink-0" />
        <span className="flex-1 flex flex-col gap-2">
          <span className="h-3 w-28 rounded bg-white/10 animate-pulse" />
          <span className="h-1.5 w-full rounded-full bg-white/10 animate-pulse" />
        </span>
        <span className="w-10 h-7 rounded bg-white/10 animate-pulse shrink-0" />
      </span>
    );
  }
  if (!earned && rating <= 0) return null;

  const points = earned ? overallPoints(earned) : 0;
  const { tier, floor, next } = overallRank(points);
  const pct = next ? Math.min(100, Math.round(((points - floor) / (next.points - floor)) * 100)) : 100;

  return (
    <span className="relative flex items-center gap-3 w-full pt-3 border-t border-white/10">
      {earned && (
        <>
          <Crest glyph="medal" tier={tier ?? 'bronze'} locked={!tier} size={36} showRibbon={false} />
          <span className="flex-1 min-w-0">
            <span className="block text-xs font-semibold truncate" style={{ color: tier ? TIER_META[tier].from : 'rgba(255,255,255,0.6)' }}>
              {tier ? t('hub.rank', { tier: TIER_META[tier].label }) : t('hub.unranked')}
              <span className="text-white/55 font-normal"> · {t('hub.crestTiers', { count: earned.length })}</span>
            </span>
            <span className="block h-1.5 mt-1.5 rounded-full bg-white/10 overflow-hidden">
              <span className="block h-full rounded-full bg-brand-green-300" style={{ width: `${pct}%` }} />
            </span>
            <span className="flex justify-between gap-2 mt-1 text-[10.5px] text-white/55">
              <span className="font-bold text-brand-green-300">{points} XP</span>
              <span className="truncate">
                {next ? t('crests.xpToNext', { xp: next.points - points, tier: TIER_META[next.tier].label }) : t('crests.maxRank')}
              </span>
            </span>
          </span>
        </>
      )}
      {rating > 0 && (
        <span className={`shrink-0 ${earned ? 'text-right pl-3 border-l border-white/10' : 'flex-1'}`}>
          <span className="block font-display font-black text-2xl leading-none tabular-nums">{rating.toFixed(1)}</span>
          <span className="block text-[10px] text-white/55 mt-1">{t('hub.careerRating')}</span>
        </span>
      )}
    </span>
  );
}

function Chevron({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}
