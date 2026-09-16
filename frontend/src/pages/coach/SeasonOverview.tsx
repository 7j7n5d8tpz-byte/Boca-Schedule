import { useMemo, useState, type FocusEvent, type MouseEvent } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import AppNav from '../../components/AppNav';
import { api } from '../../api/client';
import { useDateFormat } from '../../i18n/format';

// Coach season overview: a player × match grid replacing the coach's signup
// spreadsheet. Unlike list tables this stays a scrollable grid on phones too —
// the grid is the content, so it scrolls both ways inside its own box (never
// overflow-hidden) with the player column and match header pinned.

export type CellState = 'played' | 'no_show' | 'selected' | 'signed_up' | 'withdrawn' | 'missing' | 'none';

interface OverviewMatch {
  matchId: string;
  matchDate: string;
  matchTime: string;
  matchType: string;
  matchCategory: string;
  opponent: string | null;
  status: string;
  minPlayers: number;
  maxPlayers: number;
  signupCount: number;
  selectedCount: number;
}

interface OverviewPlayer {
  userId: string;
  name: string;
  played: number;
  selected: number;
  considered: number;
  selectionPct: number | null;
  cells: Record<string, CellState>;
}

interface Overview {
  year: number;
  seasonLabel: string;
  availableSeasons: { year: number; label: string }[];
  matches: OverviewMatch[];
  players: OverviewPlayer[];
}

type MatchFilter = 'all' | 'open';
type SortKey = 'name' | 'played' | 'pct';

const LEGEND_ORDER: CellState[] = ['played', 'selected', 'signed_up', 'withdrawn', 'missing', 'no_show', 'none'];

const CELL_STYLE: Record<CellState, string> = {
  played:    'bg-brand-green text-white',
  no_show:   'border border-brand-green text-brand-red',
  selected:  'bg-brand-green-100 text-brand-green-800',
  signed_up: 'bg-amber-100 text-amber-800',
  withdrawn: 'bg-brand-red-50 text-brand-red',
  missing:   'border border-dashed border-brand-red text-brand-red',
  none:      'text-gray-300',
};

// "12/4" — narrow enough to keep every column one chip wide.
const shortDate = (iso: string) => {
  const [, month, day] = iso.split('-').map(Number);
  return `${day}/${month}`;
};

const isOpen = (m: OverviewMatch) => m.status === 'signup_open';
// Squad is final — the header count switches from signed up to selected.
const isDecided = (m: OverviewMatch) => m.status === 'published' || m.status === 'completed';

function StateChip({ state }: { state: CellState }) {
  const { t } = useTranslation();
  return (
    <span
      role="img"
      aria-label={t(`seasonOverview.state.${state}`)}
      className={`inline-flex items-center justify-center w-8 h-8 rounded-md text-[13px] font-bold ${CELL_STYLE[state]}`}
    >
      {t(`seasonOverview.letter.${state}`)}
    </span>
  );
}

interface TooltipContent {
  title: string;
  sub?: string;
}

interface TooltipState extends TooltipContent {
  x: number;       // anchor centre, viewport px
  top: number;     // anchor top edge
  bottom: number;  // anchor bottom edge
}

// Rendered position: fixed so the grid's scroll box can't clip it. Sits above
// the anchor, flipping below when there's no room, kept inside the viewport.
function GridTooltip({ tip }: { tip: TooltipState }) {
  const above = tip.top > 80;
  const left = Math.min(Math.max(tip.x, 100), window.innerWidth - 100);
  return (
    <div
      role="tooltip"
      style={{ left, top: above ? tip.top - 6 : tip.bottom + 6 }}
      className={`fixed z-50 -translate-x-1/2 ${above ? '-translate-y-full' : ''} pointer-events-none w-max max-w-[12rem] rounded-md bg-brand-dark text-white shadow-lg px-2.5 py-1.5 text-xs text-center`}
    >
      <div className="font-semibold">{tip.title}</div>
      {tip.sub && <div className="text-gray-300">{tip.sub}</div>}
    </div>
  );
}

export default function SeasonOverview() {
  const { t } = useTranslation();
  const { formatDate } = useDateFormat();

  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [matchTypeFilter, setMatchTypeFilter] = useState<'all' | '7-player' | 'futsal'>('all');
  const [matchFilter, setMatchFilter] = useState<MatchFilter>('all');
  const [sortKey, setSortKey] = useState<SortKey>('name');

  const { data, isLoading, isError } = useQuery<Overview>({
    queryKey: ['season-overview', selectedYear, matchTypeFilter],
    queryFn: () => {
      const params = new URLSearchParams();
      if (selectedYear) params.set('year', String(selectedYear));
      if (matchTypeFilter !== 'all') params.set('matchType', matchTypeFilter);
      return api.get(`/matches/season-overview?${params}`).then(r => r.data.data);
    },
  });

  const allMatches = data?.matches ?? [];
  const openMatches = allMatches.filter(isOpen);
  const matches = matchFilter === 'open' ? openMatches : allMatches;

  const players = useMemo(() => {
    const list = [...(data?.players ?? [])];
    const byName = (a: OverviewPlayer, b: OverviewPlayer) => a.name.localeCompare(b.name);
    if (sortKey === 'played') list.sort((a, b) => b.played - a.played || byName(a, b));
    else if (sortKey === 'pct') list.sort((a, b) => (b.selectionPct ?? -1) - (a.selectionPct ?? -1) || byName(a, b));
    else list.sort(byName);
    return list;
  }, [data, sortKey]);

  const [tip, setTip] = useState<TooltipState | null>(null);
  // Hover, keyboard focus and tap (focus) all open the same tooltip.
  const tipHandlers = (content: TooltipContent) => {
    const show = (e: MouseEvent<HTMLElement> | FocusEvent<HTMLElement>) => {
      const r = e.currentTarget.getBoundingClientRect();
      setTip({ ...content, x: r.left + r.width / 2, top: r.top, bottom: r.bottom });
    };
    return {
      onMouseEnter: show,
      onFocus: show,
      onMouseLeave: () => setTip(null),
      onBlur: () => setTip(null),
      // iOS WebKit doesn't focus a button on tap, so a tap opens it too.
      onClick: show,
    };
  };

  const awaitingReply = (data?.players ?? []).filter(p => openMatches.some(m => p.cells[m.matchId] === 'missing')).length;

  const segmented = (active: boolean, first: boolean) =>
    `px-3 py-1.5 transition-colors ${first ? '' : 'border-l border-gray-200'} ${
      active ? 'bg-brand-green text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
    }`;

  return (
    <div className="min-h-screen bg-gray-50 boca-page">
      <AppNav />

      <main className="max-w-7xl mx-auto px-4 py-8">
        {/* One block sized to the grid and centred, so the header lines up with
            the grid's left edge instead of hugging the page edge. */}
        <div className="w-fit max-w-full mx-auto space-y-5">
          <div>
            <Link to="/coach" className="text-sm text-gray-500 hover:text-gray-700">← {t('nav.coachView')}</Link>
            <h1 className="text-2xl font-extrabold text-gray-900 mt-1">{t('seasonOverview.title')}</h1>
            <p className="text-sm text-gray-500 mt-1">{t('seasonOverview.subtitle')}</p>
          </div>

          {/* Filters — wrap onto several rows on phones. */}
          <div className="flex flex-wrap items-center gap-2">
            {(data?.availableSeasons ?? []).length > 0 && (
              <select
                aria-label={t('hub.season')}
                value={selectedYear ?? data?.year ?? ''}
                onChange={e => setSelectedYear(Number(e.target.value))}
                className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green bg-white"
              >
                {(data?.availableSeasons ?? []).map(s => (
                  <option key={s.year} value={s.year}>{s.label}</option>
                ))}
              </select>
            )}
            {/* Switching competitions changes the season calendar, so fall back
                to the default season. */}
            <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm" role="group" aria-label={t('stats.matchTypeAria')}>
              {(['all', '7-player', 'futsal'] as const).map((type, i) => (
                <button
                  key={type}
                  onClick={() => { setMatchTypeFilter(type); setSelectedYear(null); }}
                  className={segmented(matchTypeFilter === type, i === 0)}
                >
                  {type === 'all' ? t('hub.filterAll') : t(`matchTypes.${type}`)}
                </button>
              ))}
            </div>
            <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm">
              <button onClick={() => setMatchFilter('all')} className={segmented(matchFilter === 'all', true)}>
                {t('seasonOverview.allMatches')}
              </button>
              <button onClick={() => setMatchFilter('open')} className={segmented(matchFilter === 'open', false)}>
                {t('seasonOverview.openOnly')}
              </button>
            </div>
            <select
              aria-label={t('seasonOverview.sortBy')}
              value={sortKey}
              onChange={e => setSortKey(e.target.value as SortKey)}
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green bg-white"
            >
              <option value="name">{t('seasonOverview.sortName')}</option>
              <option value="played">{t('seasonOverview.sortPlayed')}</option>
              <option value="pct">{t('seasonOverview.sortPct')}</option>
            </select>
          </div>

          {/* At-a-glance: what the coach usually opens this page for. */}
          {data && openMatches.length > 0 && (
            <div className="flex flex-wrap gap-2 text-sm">
              <span className="bg-white border border-gray-200 rounded-lg px-3 py-1.5">
                {t('seasonOverview.openMatches')}: <strong className="text-gray-900">{openMatches.length}</strong>
              </span>
              <span className="bg-white border border-gray-200 rounded-lg px-3 py-1.5" title={t('seasonOverview.awaitingReplyHint')}>
                {t('seasonOverview.awaitingReply')}: <strong className={awaitingReply > 0 ? 'text-brand-red' : 'text-gray-900'}>{awaitingReply}</strong>
              </span>
            </div>
          )}

          {/* Legend */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-gray-600" aria-label={t('seasonOverview.legend')}>
            {LEGEND_ORDER.map(state => (
              <span key={state} className="inline-flex items-center gap-1.5">
                <StateChip state={state} />
                {t(`seasonOverview.state.${state}`)}
              </span>
            ))}
          </div>

          {isLoading ? (
            <div className="h-64 bg-white rounded-xl border border-gray-200 animate-pulse" />
          ) : isError ? (
            <p className="text-sm text-brand-red">{t('seasonOverview.loadFailed')}</p>
          ) : matches.length === 0 ? (
            <p className="text-sm text-gray-500 bg-white rounded-xl border border-gray-200 px-4 py-6 text-center">
              {matchFilter === 'open' ? t('seasonOverview.noOpenMatches') : t('seasonOverview.noMatches')}
            </p>
          ) : (
            // Scrolls on both axes inside its own box so the sticky header row and
            // player column both stay in view.
            <div
              className="max-w-full bg-white rounded-xl border border-gray-200 overflow-auto max-h-[calc(100vh-8rem)]"
              onScroll={() => setTip(null)}
            >
              <table className="border-separate border-spacing-0 text-sm">
                <thead>
                  <tr>
                    <th className="sticky top-0 left-0 z-30 bg-white border-b border-r border-gray-200 px-3 sm:px-4 py-3 align-bottom text-left">
                      <div className="flex items-end gap-2 sm:gap-3 w-[9rem] sm:w-72">
                        <span className="flex-1 min-w-0 text-xs font-semibold text-gray-500">{t('seasonOverview.player')}</span>
                        <abbr title={t('seasonOverview.playedLong')} className="w-7 sm:w-12 text-right text-xs font-semibold text-gray-500 no-underline">
                          {t('seasonOverview.played')}
                        </abbr>
                        <abbr title={t('seasonOverview.selectionPctLong')} className="w-10 sm:w-14 text-right text-xs font-semibold text-gray-500 no-underline">
                          {t('seasonOverview.selectionPct')}
                        </abbr>
                      </div>
                    </th>
                    {matches.map(m => {
                      const count = isDecided(m) ? m.selectedCount : m.signupCount;
                      const countLabel = isDecided(m)
                        ? t('seasonOverview.countDecided', { count })
                        : t('seasonOverview.countOpen', { count });
                      const status = t(`coach.status.${m.status}`, { defaultValue: m.status });
                      const heading = [formatDate(m.matchDate, 'weekdayDayMonth'), m.opponent, status, countLabel].filter(Boolean).join(' · ');
                      return (
                        <th
                          key={m.matchId}
                          scope="col"
                          className={`sticky top-0 z-20 border-b border-gray-200 px-1 sm:px-1.5 py-3 align-bottom font-normal ${isOpen(m) ? 'bg-brand-green-50' : 'bg-white'}`}
                        >
                          <Link
                            to={`/coach/matches/${m.matchId}`}
                            aria-label={heading}
                            {...tipHandlers({ title: m.opponent ?? shortDate(m.matchDate), sub: `${shortDate(m.matchDate)} · ${countLabel}` })}
                            className="flex flex-col items-center gap-1.5 w-9 sm:w-10 mx-auto rounded hover:text-brand-green focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-green"
                          >
                            <span className="[writing-mode:vertical-rl] rotate-180 max-h-28 truncate text-xs font-medium text-gray-700">
                              {m.opponent ?? t(`matchTypes.${m.matchType}`, { defaultValue: m.matchType })}
                            </span>
                            <span className="text-[11px] leading-tight text-gray-500 whitespace-nowrap">{shortDate(m.matchDate)}</span>
                            <span className={`text-[11px] leading-tight font-semibold ${isOpen(m) ? 'text-brand-green' : 'text-gray-400'}`}>{count}</span>
                          </Link>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {players.map(p => (
                    <tr key={p.userId} className="group">
                      <th scope="row" className="sticky left-0 z-10 bg-white group-hover:bg-gray-50 border-b border-r border-gray-100 px-3 sm:px-4 py-1.5 text-left font-normal">
                        <div className="flex items-center gap-2 sm:gap-3 w-[9rem] sm:w-72">
                          <Link to={`/players/${p.userId}`} className="flex-1 min-w-0 truncate text-gray-900 hover:text-brand-green">{p.name}</Link>
                          <span className="w-7 sm:w-12 text-right tabular-nums font-semibold text-gray-900">{p.played}</span>
                          <button
                            type="button"
                            {...tipHandlers({
                              title: p.selectionPct === null
                                ? t('seasonOverview.pctNone')
                                : t('seasonOverview.pctDetail', { selected: p.selected, considered: p.considered }),
                            })}
                            className="w-10 sm:w-14 text-right tabular-nums text-gray-600 rounded hover:text-brand-green focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-green"
                          >
                            {p.selectionPct === null ? '–' : `${Math.round(p.selectionPct)}%`}
                          </button>
                        </div>
                      </th>
                      {matches.map(m => {
                        const state = p.cells[m.matchId] ?? 'none';
                        return (
                          <td
                            key={m.matchId}
                            className={`border-b border-gray-100 px-1 sm:px-1.5 py-1.5 text-center group-hover:bg-gray-50 ${isOpen(m) ? 'bg-brand-green-50/60' : ''}`}
                          >
                            <button
                              type="button"
                              {...tipHandlers({
                                title: t(`seasonOverview.state.${state}`),
                                sub: [m.opponent, shortDate(m.matchDate)].filter(Boolean).join(' · '),
                              })}
                              className="block mx-auto rounded-md transition-transform hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-green focus-visible:ring-offset-1"
                            >
                              <StateChip state={state} />
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
      {tip && <GridTooltip tip={tip} />}
    </div>
  );
}
