import { useState, useRef, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import RavenIcon from './RavenIcon';

interface AppNavProps {
  backHref?: string;
  backLabel?: string;
  onBack?: () => void;
}

export default function AppNav({ backHref, backLabel = '← Back', onBack }: AppNavProps) {
  const { user, logout } = useAuth();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const isCoach = user?.role === 'coach' || user?.role === 'admin';
  const isAdmin  = user?.role === 'admin';

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
    <nav className="bg-brand-dark border-b border-brand-green/40 px-4 py-3 flex items-center gap-3">

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

      {/* ── Logo + name ── */}
      <RavenIcon className="w-12 h-12 shrink-0" />
      <span className="font-bold text-white text-lg leading-tight">Boca Boldisch</span>

      {/* ── Spacer ── */}
      <div className="flex-1" />

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
