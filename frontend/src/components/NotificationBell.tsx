import { useState, useRef, useEffect } from 'react';
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

const TYPE_ICON: Record<string, string> = {
  selected: '✅',
  match_cancelled: '❌',
  match_moved: '✏️',
  swap_request: '🔁',
  swap_accepted: '🔁',
  swap_declined: '🔁',
  signup_reminder: '⏰',
  announcement: '📣',
  spot_released: '↩️',
  result_permission_request: '🔑',
  registration: '🙋',
};

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

export default function NotificationBell() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [acted, setActed] = useState<Record<string, 'accepted' | 'declined'>>({});
  const ref = useRef<HTMLDivElement>(null);

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

  const markAll = useMutation({
    mutationFn: () => api.put('/notifications/read'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notif-count'] }),
  });

  const respond = useMutation({
    mutationFn: ({ swapId, accept }: { swapId: string; accept: boolean }) =>
      api.put(`/swaps/${swapId}/respond`, { accept }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['matches'] });
      qc.invalidateQueries({ queryKey: ['swaps-incoming'] });
      qc.invalidateQueries({ queryKey: ['notifications'] });
      qc.invalidateQueries({ queryKey: ['notif-count'] });
    },
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

  // Mark all read when the dropdown is opened with unread items
  useEffect(() => {
    if (open && unread > 0) markAll.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const notifications = listData?.notifications ?? [];

  function handleClick(n: Notification) {
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
        <span className="text-white/80 text-lg leading-none">🔔</span>
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] bg-brand-red text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 max-w-[calc(100vw-2rem)] bg-white border border-gray-100 rounded-xl shadow-2xl overflow-hidden z-50">
          <div className="px-4 py-3 border-b border-gray-100">
            <p className="text-sm font-semibold text-gray-900">Notifications</p>
          </div>

          <div className="max-h-96 overflow-y-auto divide-y divide-gray-50">
            {notifications.length === 0 && (
              <p className="text-sm text-gray-400 text-center py-8">You're all caught up.</p>
            )}
            {notifications.map(n => {
              const isSwapAction = n.type === 'swap_request' && n.refId && !acted[n.notificationId];
              const actedState = acted[n.notificationId];
              return (
                <div
                  key={n.notificationId}
                  className={`px-4 py-3 ${n.readAt ? '' : 'bg-brand-green-50/40'} ${n.link && !isSwapAction ? 'cursor-pointer hover:bg-gray-50' : ''}`}
                  onClick={() => !isSwapAction && handleClick(n)}
                >
                  <div className="flex gap-2.5">
                    <span className="text-base leading-none mt-0.5 shrink-0">{TYPE_ICON[n.type] ?? '•'}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-900">{n.title}</p>
                      {n.body && <p className="text-xs text-gray-500 mt-0.5">{n.body}</p>}
                      <p className="text-[11px] text-gray-400 mt-1">{timeAgo(n.createdAt)}</p>

                      {isSwapAction && (
                        <div className="flex gap-2 mt-2">
                          <button
                            onClick={e => { e.stopPropagation(); setActed(a => ({ ...a, [n.notificationId]: 'accepted' })); respond.mutate({ swapId: n.refId!, accept: true }); }}
                            disabled={respond.isPending}
                            className="flex-1 bg-brand-green hover:bg-brand-green-700 disabled:opacity-50 text-white text-xs font-medium py-1.5 rounded-lg transition-colors"
                          >
                            Accept
                          </button>
                          <button
                            onClick={e => { e.stopPropagation(); setActed(a => ({ ...a, [n.notificationId]: 'declined' })); respond.mutate({ swapId: n.refId!, accept: false }); }}
                            disabled={respond.isPending}
                            className="flex-1 border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50 text-xs font-medium py-1.5 rounded-lg transition-colors"
                          >
                            Decline
                          </button>
                        </div>
                      )}
                      {actedState && (
                        <p className={`text-xs font-medium mt-2 ${actedState === 'accepted' ? 'text-brand-green' : 'text-gray-400'}`}>
                          {actedState === 'accepted' ? 'Accepted ✓' : 'Declined'}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
