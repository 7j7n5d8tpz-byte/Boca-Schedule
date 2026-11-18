import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Theme } from '@astryxdesign/core/theme';
import { TopNav, TopNavHeading, TopNavItem } from '@astryxdesign/core/TopNav';
import { DropdownMenu } from '@astryxdesign/core/DropdownMenu';
import { themes, defaultThemeSlug } from '../astryx-themes';
import { useAuth } from '../context/AuthContext';
import RavenIcon from './RavenIcon';
import NotificationBell from './NotificationBell';
import { DASHBOARD_ORIGIN } from '../hubOrigin';

interface AppNavProps {
  backHref?: string;
  backLabel?: string;
  onBack?: () => void;
}

type TabId = 'home' | 'stats' | 'achievements' | 'fines' | 'coach' | 'more';

// Every page mounts its own AppNav, so the bottom bar's sliding highlight
// remembers where it last sat here and glides from there to the new tab.
let lastPillSlot: number | null = null;

function useSlidingPill(target: number) {
  const [slot, setSlot] = useState(() => lastPillSlot ?? target);
  useEffect(() => {
    lastPillSlot = target;
    // Two frames: let the start position paint before moving to the target.
    let id = requestAnimationFrame(() => { id = requestAnimationFrame(() => setSlot(target)); });
    return () => cancelAnimationFrame(id);
  }, [target]);
  return slot;
}

// Outline glyphs for the navigation (24×24, currentColor) — one per page.
const GLYPH: Record<TabId, string> = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1v-9.5Z',
  stats: 'M4 20V10M10 20V4M16 20v-7M2 20h20',
  achievements: 'M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6l7-3Zm-3 9 2.2 2.2L15 10.5',
  fines: 'M3 7h18v10H3V7Zm9 7.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM6.5 10.5v3M17.5 10.5v3',
  coach: 'M9 4h6v3H9V4ZM6 7h12v13H6V7Zm3 5h6M9 16h4',
  more: 'M5 11a1 1 0 1 0 0 2 1 1 0 0 0 0-2Zm7 0a1 1 0 1 0 0 2 1 1 0 0 0 0-2Zm7 0a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z',
};

function Glyph({ id, className = 'w-[22px] h-[22px]' }: { id: TabId; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d={GLYPH[id]} />
    </svg>
  );
}

// Astryx link slots hand over an `href`; route it through react-router so the
// top bar navigates client-side instead of reloading the page.
function RouterLink({ href, ...rest }: Omit<ComponentProps<'a'>, 'href'> & { href?: string }) {
  return <Link to={href ?? '#'} {...rest} />;
}

// Phones get the bottom bar, `sm` and up the top bar. Only one is ever mounted
// (so there is a single notification bell / menu in the tree), which is why
// this is a hook and not a pair of `sm:hidden` / `hidden sm:block` wrappers.
function useIsDesktop() {
  const query = '(min-width: 640px)';
  const [isDesktop, setIsDesktop] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(query).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const onChange = () => setIsDesktop(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return isDesktop;
}

// Safari-style: the bottom bar contracts while the page scrolls down and
// expands again on any scroll up (or at the very top).
function useScrollCompact() {
  const [compact, setCompact] = useState(false);
  const lastY = useRef(0);
  useEffect(() => {
    lastY.current = window.scrollY;
    function onScroll() {
      const y = window.scrollY;
      const delta = y - lastY.current;
      if (Math.abs(delta) < 6) return; // ignore jitter
      lastY.current = y;
      setCompact(delta > 0 && y > 24);
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  return [compact, setCompact] as const;
}

export default function AppNav({ backHref, backLabel, onBack }: AppNavProps) {
  const { user, logout } = useAuth();
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const isDesktop = useIsDesktop();
  const [compact, setCompact] = useScrollCompact();
  const [menuOpen, setMenuOpen] = useState(false);

  const back = backLabel ?? t('nav.back');
  const isCoach = user?.role === 'coach' || user?.role === 'admin';
  const isAdmin = user?.role === 'admin';
  const isFineAdmin = isAdmin || !!user?.isFineAdmin;
  const profilePath = `/players/${user?.userId}`;
  const avatarUrl = user?.avatarUrl ?? null;
  const initial = user?.name?.charAt(0).toUpperCase() ?? '?';

  const under = (to: string) => pathname === to || pathname.startsWith(to + '/');
  // Phones use short labels that fit a fifth of the bar; the desktop top bar has
  // room for the full page names.
  const tabs: { id: TabId; to: string; label: string; active: boolean }[] = [
    { id: 'home', to: '/dashboard', label: t('nav.tabHome'), active: under('/dashboard') },
    { id: 'stats', to: '/statistics', label: isDesktop ? t('nav.teamStats') : t('nav.tabStats'), active: under('/statistics') },
    { id: 'achievements', to: '/achievements', label: isDesktop ? t('nav.achievements') : t('nav.tabAchievements'), active: under('/achievements') },
    { id: 'fines', to: '/fines', label: isDesktop ? t('nav.fines') : t('nav.tabFines'), active: under('/fines') && !under('/fines/manage') },
  ];
  // Whatever isn't one of the four tabs lives behind "More" on phones.
  const current = tabs.find(tab => tab.active) ?? { id: 'more' as TabId, label: t('nav.more') };

  const avatar = (size: string) => (
    <span className={`${size} rounded-full overflow-hidden bg-brand-green text-white font-bold flex items-center justify-center shrink-0`}>
      {avatarUrl ? <img src={avatarUrl} alt="" className="w-full h-full object-cover" /> : initial}
    </span>
  );

  // Profile first, then the management views, then settings / log out. On
  // desktop the coach view sits in the top bar itself, so it is left out here.
  const menuItems = [
    { label: user?.name ?? t('nav.yourProfile'), description: t('nav.viewProfile'), onClick: () => navigate(profilePath, { state: DASHBOARD_ORIGIN }) },
    ...(isCoach && !isDesktop ? [{ label: t('nav.coachView'), onClick: () => navigate('/coach') }] : []),
    ...(isFineAdmin ? [{ label: t('nav.manageFines'), onClick: () => navigate('/fines/manage') }] : []),
    ...(isAdmin ? [{ label: t('nav.adminPanel'), onClick: () => navigate('/admin') }] : []),
    { label: t('nav.settings'), onClick: () => navigate('/settings') },
    { label: t('nav.logOut'), variant: 'destructive' as const, onClick: () => { void logout(); } },
  ];

  const backControl = (cls: string): ReactNode => {
    if (!backHref && !onBack) return null;
    const inner = (
      <>
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4 shrink-0" aria-hidden>
          <path d="M12 5l-5 5 5 5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {back}
      </>
    );
    return backHref
      ? <Link to={backHref} aria-label={t('nav.backTo', { label: back })} className={cls}>{inner}</Link>
      : <button onClick={onBack} aria-label={t('nav.backTo', { label: back })} className={cls}>{inner}</button>;
  };

  // ── Desktop: Astryx top bar in the dark chrome ───────────────────────────
  if (isDesktop) {
    return (
      <Theme theme={themes[defaultThemeSlug]} mode="dark">
        <header className="sticky top-0 z-40 bg-brand-dark">
          <TopNav
            label={t('nav.main')}
            heading={
              <TopNavHeading
                as={RouterLink}
                headingHref="/dashboard"
                heading="Boca Boldisch"
                logo={
                  // Crest on the kit stripe, which runs the full height of the bar.
                  <span className="relative flex items-center shrink-0 mx-1">
                    <span className="absolute left-1/2 -translate-x-1/2 -top-2 -bottom-2 flex" aria-hidden>
                      <span className="w-3.5 bg-brand-green" />
                      <span className="w-3.5 bg-brand-red" />
                      <span className="w-3.5 bg-brand-green" />
                    </span>
                    <RavenIcon className="relative w-12 h-12 shrink-0" />
                  </span>
                }
              />
            }
            startContent={backControl('inline-flex items-center gap-1 rounded-full bg-white/10 hover:bg-white/20 text-white text-sm font-medium pl-2 pr-3 h-9 transition-colors shrink-0')}
            centerContent={
              <>
                {tabs.map(tab => (
                  <TopNavItem key={tab.id} as={RouterLink} href={tab.to} label={tab.label} icon={<Glyph id={tab.id} className="w-5 h-5" />} isSelected={tab.active} />
                ))}
                {isCoach && (
                  <TopNavItem as={RouterLink} href="/coach" label={t('nav.coachView')} icon={<Glyph id="coach" className="w-5 h-5" />} isSelected={under('/coach')} />
                )}
              </>
            }
            endContent={
              <>
                <NotificationBell />
                <DropdownMenu
                  items={menuItems}
                  placement="below"
                  alignment="end"
                  menuWidth={240}
                  hasChevron={false}
                  renderTrigger={props => (
                    <button {...props} aria-label={t('nav.openMenu')} className="rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/70">
                      {avatar('w-10 h-10 text-sm')}
                    </button>
                  )}
                />
              </>
            }
          />
        </header>
      </Theme>
    );
  }

  // ── Phones: floating bell + bottom bar ───────────────────────────────────
  // The green highlight is one shared pill that slides between the tabs
  // (see BottomTabs), so the tabs themselves stay transparent.
  const tabCls = (active: boolean) =>
    `relative z-10 flex flex-col items-center justify-center gap-0.5 flex-1 min-w-0 h-[52px] rounded-full transition-[color,transform] duration-200 active:scale-95 motion-reduce:transition-none ${
      active ? 'text-white' : 'text-white/75 hover:text-white'
    }`;
  const activeSlot = current.id === 'more' ? tabs.length : tabs.findIndex(tab => tab.active);

  return (
    <>
      {/* Top strip: no ribbon any more, just an in-flow spacer the height of
          the floating controls. The optional back pill (left) and the bell
          (right) are both fixed, so they stay put while the page scrolls. */}
      <div
        style={{ paddingTop: 'calc(0.75rem + env(safe-area-inset-top))' }}
        className="box-content h-11 pb-1"
        aria-hidden
      />
      <div
        style={{ top: 'calc(0.75rem + env(safe-area-inset-top))' }}
        className="fixed left-3 z-40 max-w-[calc(100vw-5.5rem)]"
      >
        {backControl('flex items-center gap-1 max-w-full truncate rounded-full bg-white/90 border border-gray-200 shadow-md backdrop-blur hover:bg-white text-brand-dark text-sm font-medium pl-2.5 pr-3.5 h-11 transition-colors')}
      </div>
      <div
        style={{ top: 'calc(0.75rem + env(safe-area-inset-top))' }}
        className="fixed right-3 z-40"
      >
        <NotificationBell floating />
      </div>

      <nav
        data-app-bottom-nav
        aria-label={t('nav.main')}
        style={{ bottom: `calc(${compact ? '10px' : '18px'} + env(safe-area-inset-bottom))` }}
        className={`fixed left-1/2 -translate-x-1/2 z-40 rounded-full bg-brand-dark/95 backdrop-blur shadow-[0_12px_28px_-10px_rgba(16,47,31,0.55)] overflow-hidden transition-[width,height,bottom] duration-300 ease-[cubic-bezier(0.22,0.8,0.2,1)] motion-reduce:transition-none ${
          compact ? 'w-44 h-11' : 'w-[calc(100vw-2rem)] max-w-[26rem] h-[68px]'
        }`}
      >
        {compact ? (
          <button
            onClick={() => setCompact(false)}
            aria-label={t('nav.showNav')}
            className="w-full h-full flex items-center justify-center gap-2 text-white"
          >
            <Glyph id={current.id} className="w-[18px] h-[18px]" />
            <span className="text-[13px] font-semibold truncate">{current.label}</span>
          </button>
        ) : (
          <BottomTabs slot={activeSlot} count={tabs.length + 1}>
            {tabs.map(tab => (
              <Link key={tab.id} to={tab.to} aria-current={tab.active ? 'page' : undefined} className={tabCls(tab.active)}>
                <Glyph id={tab.id} />
                <span className="text-[11px] font-semibold leading-tight max-w-full truncate px-1">{tab.label}</span>
              </Link>
            ))}
            <DropdownMenu
              items={menuItems}
              presentation="bottom-sheet"
              hasChevron={false}
              isMenuOpen={menuOpen}
              onOpenChange={setMenuOpen}
              renderTrigger={props => (
                <button {...props} className={tabCls(current.id === 'more')}>
                  <Glyph id="more" />
                  <span className="text-[11px] font-semibold leading-tight">{t('nav.more')}</span>
                </button>
              )}
            />
          </BottomTabs>
        )}
      </nav>
    </>
  );
}

// Row of bottom-bar tabs with the active-tab pill gliding underneath. Tabs are
// equal flex-1 slots 2px apart (gap-0.5) inside 8px padding (px-2), so the pill
// is one slot wide and moves by whole slots (+ gap) via translateX.
function BottomTabs({ slot, count, children }: { slot: number; count: number; children: ReactNode }) {
  const shown = useSlidingPill(slot);
  return (
    <div className="relative h-full flex items-center gap-0.5 px-2">
      <span
        aria-hidden
        style={{
          width: `calc((100% - 1rem - ${(count - 1) * 2}px) / ${count})`,
          transform: `translateX(calc(${shown} * (100% + 2px)))`,
        }}
        className="absolute left-2 top-1/2 -mt-[26px] h-[52px] rounded-full bg-brand-green transition-transform duration-[420ms] ease-[cubic-bezier(0.32,1.25,0.5,1)] motion-reduce:transition-none"
      />
      {children}
    </div>
  );
}
