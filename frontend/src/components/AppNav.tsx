import { useState, useRef, useEffect, useCallback } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import RavenIcon from './RavenIcon';
import NotificationBell from './NotificationBell';

interface AppNavProps {
  backHref?: string;
  backLabel?: string;
  onBack?: () => void;
}

export default function AppNav({ backHref, backLabel = '← Back', onBack }: AppNavProps) {
  const { user, logout } = useAuth();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Hide the (sticky) nav when scrolling down, reveal it when scrolling up —
  // so it's reachable from anywhere on the page, not just the top.
  const lastY = useRef(0);
  const autoHide = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const openRef = useRef(open);
  openRef.current = open;
  const hoveringRef = useRef(false);
  const notifOpenRef = useRef(false);

  // Re-hide 1s after the nav is revealed mid-page so it doesn't linger. Held
  // off whenever the user is hovering the bar, the menu is open, or the
  // notification panel is open — so they can actually use it. Callers re-arm
  // this on the matching "released" event (mouse leave, panel/menu close).
  const armAutoHide = useCallback(() => {
    clearTimeout(autoHide.current);
    if (window.scrollY > 0 && !openRef.current && !notifOpenRef.current && !hoveringRef.current) {
      autoHide.current = setTimeout(() => setHidden(true), 1000);
    }
  }, []);

  useEffect(() => {
    lastY.current = window.scrollY;
    function onScroll() {
      const y = window.scrollY;
      const delta = y - lastY.current;
      // Ignore tiny jitter. Hide as soon as the user starts scrolling down;
      // reveal on any scroll up. Every scroll resets the auto-hide timer.
      if (Math.abs(delta) > 6) {
        lastY.current = y;
        // Never yank the nav away from an open menu / notification panel — if
        // the user scrolls while one is open, keep the nav put.
        if (openRef.current || notifOpenRef.current) {
          setHidden(false);
          clearTimeout(autoHide.current);
          return;
        }
        const nextHidden = delta > 0 && y > 0;
        setHidden(nextHidden);
        if (nextHidden) clearTimeout(autoHide.current);
        else armAutoHide();
      }
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      clearTimeout(autoHide.current);
    };
  }, [armAutoHide]);

  // Keep the nav shown while the menu is open (and cancel any pending auto-hide
  // so it can't close under the open menu). When the menu closes again mid-page,
  // re-arm the idle auto-hide — otherwise opening/closing it would pin the nav.
  const prevOpen = useRef(open);
  useEffect(() => {
    if (open) {
      clearTimeout(autoHide.current);
      setHidden(false);
    } else if (prevOpen.current) {
      armAutoHide();
    }
    prevOpen.current = open;
  }, [open, armAutoHide]);

  // Mirror the hidden state onto <html> so sticky sidebars can offset their
  // `top` by the nav's current visible height and slide up/down in lockstep.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('app-nav-hidden', hidden);
    return () => root.classList.remove('app-nav-hidden');
  }, [hidden]);

  const isCoach = user?.role === 'coach' || user?.role === 'admin';
  const isAdmin  = user?.role === 'admin';
  const isFineAdmin = isAdmin || !!user?.isFineAdmin;

  const navLink = (to: string, label: string, color = 'text-white/75') => {
    const active = pathname === to || pathname.startsWith(to + '/');
    return (
      <Link
        to={to}
        onClick={() => setOpen(false)}
        className={`flex items-center justify-between px-4 py-2.5 text-sm transition-colors hover:bg-white/10 ${
          active ? 'text-white font-semibold bg-white/10' : `${color} hover:text-white`
        }`}
      >
        {label}
      </Link>
    );
  };

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <nav
      // Pointer events (not mouse) so a touch tap — which synthesizes mouse
      // events and would otherwise leave `hovering` stuck true with no
      // leave — never engages the hover bypass. Hover is a mouse-only concept.
      onPointerEnter={e => { if (e.pointerType === 'mouse') { hoveringRef.current = true; clearTimeout(autoHide.current); } }}
      onPointerLeave={e => { if (e.pointerType === 'mouse') { hoveringRef.current = false; armAutoHide(); } }}
      className={`sticky top-0 z-40 bg-brand-dark px-4 py-3 flex items-center gap-3 transition-[transform,opacity] ${
        hidden ? '-translate-y-full opacity-0 duration-[450ms]' : 'translate-y-0 opacity-100 duration-300'
      }`}
    >

      {/* ── Optional back link ── */}
      {(backHref || onBack) && (
        <>
          {backHref
            ? <Link to={backHref} className="text-white/50 hover:text-white/80 text-sm transition-colors shrink-0">{backLabel}</Link>
            : <button onClick={onBack} className="text-white/50 hover:text-white/80 text-sm transition-colors shrink-0">{backLabel}</button>
          }
          <div className="w-px h-5 bg-white/20 shrink-0" />
        </>
      )}

      {/* ── Logo + name → player dashboard, the shared home for everyone (coaches
             and admins are players too; their /coach and /admin views are
             management-only and reached via the menu). Wordmark hidden on phones
             so the back link + nav icons always fit. ── */}
      <Link
        to="/dashboard"
        onClick={() => setOpen(false)}
        aria-label="Boca Boldisch home"
        className="flex items-center gap-2 sm:gap-3 shrink-0 rounded-lg hover:opacity-80 transition-opacity"
      >
        {/* Crest on the kit stripe — mirrors the login hero lockup. The stripe
            runs the full nav height (extends past the crest via -top-3/-bottom-3
            into the nav's py-3 padding) and the crest sits on top of it. */}
        <span className="relative flex items-center shrink-0">
          <span className="absolute left-1/2 -translate-x-1/2 -top-3 -bottom-3 flex" aria-hidden>
            <span className="w-3 sm:w-3.5 bg-brand-green" />
            <span className="w-3 sm:w-3.5 bg-brand-red" />
            <span className="w-3 sm:w-3.5 bg-brand-green" />
          </span>
          <RavenIcon className="relative z-10 w-12 h-12 sm:w-14 sm:h-14 shrink-0" />
        </span>
        <span className="hidden sm:block font-display font-extrabold uppercase tracking-wide text-white text-lg leading-tight">Boca Boldisch</span>
      </Link>

      {/* ── Spacer ── */}
      <div className="flex-1" />

      {/* ── Notification bell ── */}
      <NotificationBell
        onOpenChange={o => {
          notifOpenRef.current = o;
          if (o) clearTimeout(autoHide.current);
          else armAutoHide();
        }}
      />

      {/* ── Hamburger menu (top-right) ── */}
      <div className="relative shrink-0" ref={menuRef}>
        <button
          onClick={() => setOpen(o => !o)}
          aria-label="Open menu"
          aria-expanded={open}
          className="flex flex-col justify-center items-center w-9 h-9 rounded-lg hover:bg-white/10 transition-colors gap-[5px]"
        >
          <span className={`block w-5 h-0.5 bg-white/80 rounded transition-all duration-200 origin-center ${open ? 'rotate-45 translate-y-[7px]' : ''}`} />
          <span className={`block w-5 h-0.5 bg-white/80 rounded transition-all duration-200 ${open ? 'opacity-0 scale-x-0' : ''}`} />
          <span className={`block w-5 h-0.5 bg-white/80 rounded transition-all duration-200 origin-center ${open ? '-rotate-45 -translate-y-[7px]' : ''}`} />
        </button>

        {open && (
          <div className="absolute right-0 top-full mt-2 w-56 bg-[#0f1f0f] border border-white/10 rounded-xl shadow-2xl overflow-hidden z-50">
            {/* User */}
            {user?.name && (
              <>
                <Link
                  to="/profile"
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-2.5 px-4 py-3 text-sm font-semibold text-white hover:bg-white/10 transition-colors"
                >
                  <span className="w-7 h-7 rounded-full bg-brand-green/30 text-brand-green text-xs font-bold flex items-center justify-center shrink-0">
                    {user.name.charAt(0).toUpperCase()}
                  </span>
                  {user.name}
                </Link>
                <div className="h-px bg-white/10 mx-3" />
              </>
            )}

            {/* Navigation */}
            <div className="py-1">
              {isCoach
                ? navLink('/dashboard', 'Player view')
                : navLink('/dashboard', 'Dashboard')
              }
              {navLink('/statistics', 'Team stats')}
              {navLink('/fines', 'Fines')}
              {isFineAdmin && navLink('/fines/manage', 'Manage fines')}
              {isCoach && navLink('/coach', 'Coach view')}
              {isAdmin && navLink('/admin', 'Admin panel', 'text-purple-300')}
            </div>

            <div className="h-px bg-white/10 mx-3" />

            <div className="py-1">
              <button
                onClick={() => { logout(); setOpen(false); }}
                className="w-full text-left px-4 py-2.5 text-sm text-red-400 hover:text-red-300 hover:bg-white/10 transition-colors"
              >
                Log out
              </button>
            </div>
          </div>
        )}
      </div>
    </nav>
  );
}
