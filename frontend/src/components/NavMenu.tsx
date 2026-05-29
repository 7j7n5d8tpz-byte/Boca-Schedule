import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';

export interface NavMenuItem {
  label: string;
  to?: string;
  onClick?: () => void;
  color?: string;
  divider?: boolean;
}

export default function NavMenu({ userName, items }: {
  userName: string;
  items: NavMenuItem[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(p => !p)}
        aria-label="Open menu"
        aria-expanded={open}
        className={`flex flex-col justify-center gap-1.5 p-2 rounded-lg transition-colors ${open ? 'bg-white/15' : 'hover:bg-white/10'}`}
      >
        <span className="w-5 h-0.5 bg-white rounded-full block" />
        <span className="w-5 h-0.5 bg-white rounded-full block" />
        <span className="w-5 h-0.5 bg-white rounded-full block" />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 bg-white rounded-xl shadow-xl border border-gray-100 py-2 min-w-[192px] z-50">
          <div className="px-4 py-2 border-b border-gray-100 mb-1">
            <p className="text-[11px] text-gray-400 font-medium uppercase tracking-wide">Signed in as</p>
            <p className="text-sm font-semibold text-gray-800 truncate mt-0.5">{userName}</p>
          </div>
          {items.map((item, i) => (
            <div key={i}>
              {item.divider && <div className="border-t border-gray-100 my-1" />}
              {item.to ? (
                <Link
                  to={item.to}
                  onClick={() => setOpen(false)}
                  className={`flex items-center px-4 py-2 text-sm transition-colors hover:bg-gray-50 ${item.color ?? 'text-gray-700'}`}
                >
                  {item.label}
                </Link>
              ) : (
                <button
                  onClick={() => { item.onClick?.(); setOpen(false); }}
                  className={`w-full text-left flex items-center px-4 py-2 text-sm transition-colors hover:bg-gray-50 ${item.color ?? 'text-gray-700'}`}
                >
                  {item.label}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
