import { useState, useRef, useEffect, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';

interface Notification {
  notificationId: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  matchId: string | null;
  refId: string | null;
  readAt: string | null;
  createdAt: string;
}

// Tinted circular badge tones. Colour carries the sentiment (green = good,
// red = cancelled, amber = needs attention, blue = info, gray = neutral),
// the line icon carries the specific event — together they disambiguate types
// that used to share an emoji (e.g. cancelled vs. claim-rejected).
const TONE: Record<string, string> = {
  green:  'bg-green-100 text-green-600',
  red:    'bg-red-100 text-red-600',
  amber:  'bg-amber-100 text-amber-600',
  blue:   'bg-blue-100 text-blue-600',
  purple: 'bg-purple-100 text-purple-600',
  gray:   'bg-gray-100 text-gray-500',
};

function iconFor(type: string): { tone: keyof typeof TONE; paths: ReactNode } {
  switch (type) {
    case 'selected':                   // "You're selected"
    case 'claim_accepted':             // "You're in the squad"
      return { tone: 'green',  paths: <><circle cx="12" cy="12" r="9" /><path d="M8.5 12.5l2.5 2.5 4.5-5" /></> };
    case 'spot_open':                  // "A spot opened up"
      return { tone: 'green',  paths: <><circle cx="12" cy="12" r="9" /><path d="M12 8v8M8 12h8" /></> };
    case 'match_cancelled':            // "Match cancelled"
      return { tone: 'red',    paths: <><circle cx="12" cy="12" r="9" /><path d="M15 9l-6 6M9 9l6 6" /></> };
    case 'claim_rejected':             // "Spot went to someone else"
      return { tone: 'gray',   paths: <><circle cx="12" cy="12" r="9" /><path d="M15 9l-6 6M9 9l6 6" /></> };
    case 'signup_reminder':            // "Signup closing soon"
      return { tone: 'amber',  paths: <><circle cx="12" cy="12" r="9" /><path d="M12 7.5V12l3 1.5" /></> };
    case 'matchday_reminder':          // "Match tomorrow"
      return { tone: 'green',  paths: <><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M8 3v4M16 3v4M4 9.5h16" /><path d="M9 14.5l2 2 4-4" /></> };
    case 'selection_reminder':         // "N squads need picking" (coach)
      return { tone: 'amber',  paths: <><circle cx="9" cy="8" r="3" /><path d="M15 5.5a3 3 0 0 1 0 5" /><path d="M3.5 20a5.5 5.5 0 0 1 11 0" /><path d="M16.5 14.6A5.5 5.5 0 0 1 20.5 20" /></> };
    case 'result_reminder':            // "Record the result" (coach)
      return { tone: 'amber',  paths: <><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="M14 6l4 4" /></> };
    case 'match_moved':                // "Match details changed"
      return { tone: 'amber',  paths: <><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M8 3v4M16 3v4M4 9.5h16" /></> };
    case 'spot_claim':                 // "Spot claimed" (coach)
      return { tone: 'amber',  paths: <><path d="M6 21V4" /><path d="M6 5h11l-2.5 3.5L17 12H6" /></> };
    case 'spot_released':              // "Spot released"
      return { tone: 'gray',   paths: <><path d="M3 10h11a4 4 0 1 1 0 8h-2" /><path d="M6 7l-3 3 3 3" /></> };
    case 'announcement':               // "New announcement"
      return { tone: 'blue',   paths: <><path d="M4 10v4h3l8 4V6L7 10H4z" /><path d="M18.5 10a3.5 3.5 0 0 1 0 4" /></> };
    case 'registration':               // "New registration" (admin)
      return { tone: 'blue',   paths: <><circle cx="10" cy="8" r="3.5" /><path d="M4 20c0-3.3 2.7-6 6-6s6 2.7 6 6" /><path d="M18 8h4M20 6v4" /></> };
    case 'result_permission_request':  // "Result access requested"
      return { tone: 'purple', paths: <><circle cx="7" cy="17" r="3" /><path d="M9 15 19 5M16 6l2 2M14 8l2 2" /></> };
    case 'fine_issued':                // "You received a fine"
    case 'fine_pending_approval':      // "Fine awaiting approval" (admin)
      return { tone: 'amber',  paths: <><rect x="3" y="6" width="18" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /></> };
    case 'fine_payment_claimed':       // "Fine payment claimed" (admin)
      return { tone: 'blue',   paths: <><rect x="3" y="6" width="18" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /></> };
    case 'fine_payment_confirmed':     // "Fine payment confirmed"
      return { tone: 'green',  paths: <><circle cx="12" cy="12" r="9" /><path d="M8.5 12.5l2.5 2.5 4.5-5" /></> };
    case 'fine_claim_rejected':        // "Payment not received"
      return { tone: 'red',    paths: <><rect x="3" y="6" width="18" height="12" rx="2" /><path d="M15 10l-6 4M9 10l6 4" /></> };
    case 'fine_voided':                // "A fine was cancelled"
      return { tone: 'gray',   paths: <><rect x="3" y="6" width="18" height="12" rx="2" /><path d="M7 17 17 7" /></> };
    default:
      return { tone: 'gray',   paths: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></> };
  }
}

function TypeIcon({ type }: { type: string }) {
  const { tone, paths } = iconFor(type);
  return (
    <span className={`mt-0.5 shrink-0 w-7 h-7 rounded-full flex items-center justify-center ${TONE[tone]}`}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4" aria-hidden="true">
        {paths}
      </svg>
    </span>
  );
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export default function NotificationBell({ onOpenChange }: { onOpenChange?: (open: boolean) => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'new' | 'all'>('new');
  const ref = useRef<HTMLDivElement>(null);

  // Report open/close to the parent (AppNav) so it can suspend its auto-hide
  // while the panel is open. Via a ref so parent re-renders don't re-fire it —
  // only an actual open-state change does.
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;
  useEffect(() => { onOpenChangeRef.current?.(open); }, [open]);

  const { data: countData } = useQuery<{ unreadCount: number }>({
    queryKey: ['notif-count'],
    queryFn: () => api.get('/notifications/unread-count').then(r => r.data.data),
    refetchInterval: 30_000,
  });
  const unread = countData?.unreadCount ?? 0;

  const { data: listData } = useQuery<{ unreadCount: number; notifications: Notification[] }>({
    queryKey: ['notifications'],
    queryFn: () => api.get('/notifications').then(r => r.data.data),
    enabled: open,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['notif-count'] });
    qc.invalidateQueries({ queryKey: ['notifications'] });
  };

  const markAll = useMutation({
    mutationFn: () => api.put('/notifications/read'),
    onSuccess: invalidate,
  });

  // Mark a single notification read (on click). Only the one you open is read.
  const markOne = useMutation({
    mutationFn: (id: string) => api.put(`/notifications/${id}/read`),
    onSuccess: invalidate,
  });

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // On open: land on the "New" tab. Nothing is marked read until you click it.
  useEffect(() => {
    if (open) setTab('new');
  }, [open]);

  const notifications = listData?.notifications ?? [];
  const isNew = (n: Notification) => !n.readAt;
  const newItems = notifications.filter(isNew);
  const shown = tab === 'new' ? newItems : notifications;

  function handleClick(n: Notification) {
    if (!n.readAt) markOne.mutate(n.notificationId);
    if (n.link) { setOpen(false); navigate(n.link); }
  }

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        aria-label="Notifications"
        aria-expanded={open}
        className="relative flex items-center justify-center w-9 h-9 rounded-lg hover:bg-white/10 transition-colors"
      >
        {/* Monochrome bell — matches the nav's flat white/80 line work */}
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.6}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="w-5 h-5 text-white/80"
        >
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] bg-brand-red text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 max-w-[calc(100vw-2rem)] bg-white border border-gray-100 rounded-xl shadow-2xl overflow-hidden z-50">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-gray-900">Notifications</p>
            {newItems.length > 0 && (
              <button
                onClick={() => markAll.mutate()}
                disabled={markAll.isPending}
                className="text-xs font-medium text-brand-green hover:underline disabled:opacity-50"
              >
                Mark all read
              </button>
            )}
          </div>

          {/* New / All tabs */}
          <div className="flex gap-1 px-2 py-2 border-b border-gray-100">
            {(['new', 'all'] as const).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex-1 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors ${
                  tab === t ? 'bg-brand-green text-white' : 'text-gray-500 hover:bg-gray-100'
                }`}
              >
                {t === 'new' ? `New${newItems.length ? ` (${newItems.length})` : ''}` : 'All'}
              </button>
            ))}
          </div>

          <div className="max-h-96 overflow-y-auto divide-y divide-gray-50">
            {shown.length === 0 && (
              <p className="text-sm text-gray-400 text-center py-8">
                {tab === 'new' ? "You're all caught up." : 'No notifications yet.'}
              </p>
            )}
            {shown.map(n => (
              <button
                type="button"
                key={n.notificationId}
                onClick={() => handleClick(n)}
                className={`w-full text-left px-4 py-3 border-l-2 transition-colors hover:bg-gray-50 ${
                  isNew(n) ? 'border-brand-green bg-brand-green-50/40' : 'border-transparent'
                }`}
              >
                <div className="flex gap-2.5">
                  <TypeIcon type={n.type} />
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm ${isNew(n) ? 'font-semibold text-gray-900' : 'font-medium text-gray-600'}`}>{n.title}</p>
                    {n.body && <p className="text-xs text-gray-500 mt-0.5">{n.body}</p>}
                    <p className="text-[11px] text-gray-400 mt-1">{timeAgo(n.createdAt)}</p>
                  </div>
                  {isNew(n) && <span className="mt-1.5 w-2 h-2 rounded-full bg-brand-green shrink-0" aria-label="New" />}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
