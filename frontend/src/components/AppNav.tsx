import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
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

  // Profile picture (uploaded via the profile page); null → initials fallback.
  const avatarUrl = user?.avatarUrl ?? null;
  const initial = user?.name?.charAt(0).toUpperCase() ?? '?';

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

  // Push the whole app (#root) aside while the drawer is open — see index.css.
  // The drawer/backdrop are portaled out of #root so this transform doesn't
  // capture their fixed positioning.
  useEffect(() => {
    document.documentElement.classList.toggle('app-drawer-open', open);
    return () => document.documentElement.classList.remove('app-drawer-open');
  }, [open]);

  // Close on Escape (the backdrop handles click-outside).
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <nav
      // Pointer events (not mouse) so a touch tap — which synthesizes mouse
      // events and would otherwise leave `hovering` stuck true with no
      // leave — never engages the hover bypass. Hover is a mouse-only concept.
      onPointerEnter={e => { if (e.pointerType === 'mouse') { hoveringRef.current = true; clearTimeout(autoHide.current); } }}
      onPointerLeave={e => { if (e.pointerType === 'mouse') { hoveringRef.current = false; armAutoHide(); } }}
      // Extend the nav's dark background up under the iOS notch (the py-3 top
      // padding plus the safe-area inset), so the status-bar region reads as the
      // nav rather than a stuck dark bar. env() is 0 off-notch / without
      // viewport-fit=cover, leaving the plain py-3. The full-height translate on
      // hide carries this padding too, so it clears completely when scrolled.
      style={{ paddingTop: 'calc(0.75rem + env(safe-area-inset-top))' }}
      className={`sticky top-0 z-40 bg-brand-dark px-4 py-3 flex items-center gap-3 transition-[transform,opacity] ${
        hidden ? '-translate-y-full opacity-0 duration-[450ms]' : 'translate-y-0 opacity-100 duration-300'
      }`}
    >

      {/* ── Hamburger (far left) → opens the left push drawer ── */}
      <button
        onClick={() => setOpen(o => !o)}
        aria-label="Open menu"
        aria-expanded={open}
        className="flex flex-col justify-center items-center w-9 h-9 rounded-lg hover:bg-white/10 transition-colors gap-[5px] shrink-0"
      >
        {/* Static three lines — the drawer carries its own close (×) button, so
            the burger doesn't morph to an X (it would get pushed alongside the
            drawer's × and read as a duplicate). */}
        <span className="block w-5 h-0.5 bg-white/80 rounded" />
        <span className="block w-5 h-0.5 bg-white/80 rounded" />
        <span className="block w-5 h-0.5 bg-white/80 rounded" />
      </button>

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

      {/* ── Profile avatar (far right) → profile page. Placeholder initial
             circle for now; swap in an uploaded photo later. ── */}
      <Link
        to="/profile"
        aria-label="Your profile"
        className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 overflow-hidden text-sm font-bold transition-all ${
          pathname === '/profile' ? 'ring-2 ring-white/40' : 'hover:opacity-90'
        } ${avatarUrl ? 'bg-white/10' : pathname === '/profile' ? 'bg-brand-green text-white' : 'bg-brand-green/30 text-brand-green'}`}
      >
        {avatarUrl
          ? <img src={avatarUrl} alt="" className="w-full h-full object-cover" />
          : initial}
      </Link>

      {/* ── Left push drawer ── portaled into <body> (outside #root) so it stays
             fixed to the viewport while #root slides aside. ── */}
      {createPortal(
        <>
          {/* Backdrop over the pushed-aside page */}
          <div
            onClick={() => setOpen(false)}
            aria-hidden
            className={`fixed inset-0 z-[60] bg-black/40 transition-opacity duration-300 ${
              open ? 'opacity-100' : 'opacity-0 pointer-events-none'
            }`}
          />

          {/* Drawer panel */}
          <aside
            aria-hidden={!open}
            className={`fixed inset-y-0 left-0 z-[70] w-[280px] max-w-[85vw] bg-[#0f1f0f] border-r border-white/10 shadow-2xl flex flex-col transition-transform duration-300 ease-[cubic-bezier(0.22,0.8,0.2,1)] ${
              open ? 'translate-x-0' : '-translate-x-full'
            }`}
          >
            {/* Header: user + close */}
            <div className="flex items-center gap-3 px-4 py-4 border-b border-white/10">
              <span className="w-9 h-9 rounded-full overflow-hidden bg-brand-green/30 text-brand-green text-sm font-bold flex items-center justify-center shrink-0">
                {avatarUrl
                  ? <img src={avatarUrl} alt="" className="w-full h-full object-cover" />
                  : initial}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-white font-semibold text-sm truncate">{user?.name ?? 'Menu'}</div>
                {user?.role && <div className="text-white/40 text-xs capitalize">{user.role}</div>}
              </div>
              <button
                onClick={() => setOpen(false)}
                aria-label="Close menu"
                className="w-8 h-8 rounded-lg flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition-colors shrink-0"
              >
                <span className="text-xl leading-none">&times;</span>
              </button>
            </div>

            {/* Navigation */}
            <div className="flex-1 overflow-y-auto py-2">
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

            {/* Footer: log out */}
            <div className="border-t border-white/10 py-2">
              <button
                onClick={() => { logout(); setOpen(false); }}
                className="w-full text-left px-4 py-2.5 text-sm text-red-400 hover:text-red-300 hover:bg-white/10 transition-colors"
              >
                Log out
              </button>
            </div>
          </aside>
        </>,
        document.body,
      )}
    </nav>
  );
}
