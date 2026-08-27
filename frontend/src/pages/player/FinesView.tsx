import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useDateFormat } from '../../i18n/format';
import { formatKr as kr, STATUS_META, fineWhat, computeTotals, computeStandings, type FineStatus } from './finesUtil';

// ─── Types ──────────────────────────────────────────────────────────────────

interface Fine {
  fineId: string;
  playerId: string;
  playerName: string | null;
  amountDkk: number;
  typeLabel: string | null;
  reason: string | null;
  matchId: string | null;
  matchLabel: string | null;
  status: FineStatus;
  disputed: boolean;
  disputeNote: string | null;
  createdAt: string;
  approvedAt: string | null;
  paidClaimedAt: string | null;
  confirmedAt: string | null;
}

interface MyFinesData {
  fines: Fine[];
  totals: { outstandingDkk: number; claimedDkk: number; paidDkk: number };
  paymentInfo: string;
  isFineAdmin: boolean;
}

interface AdminData {
  pendingApproval: Fine[];
  paymentClaimed: Fine[];
  overview: { playerId: string; name: string; outstandingDkk: number; claimedDkk: number; paidDkk: number; unpaidCount: number }[];
  treasury: { collectedDkk: number; outstandingDkk: number };
  paymentInfo: string;
}

interface FineType { fineTypeId: string; label: string; amountDkk: number; active: boolean; sortOrder: number }
interface PlayerLite { userId: string; name: string }

// ─── Helpers ────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: FineStatus }) {
  const { t } = useTranslation();
  const m = STATUS_META[status];
  return <span className={`text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${m.cls}`}>{t(m.labelKey)}</span>;
}

/** What a fine was for, with the translated fallback when nothing was recorded. */
function useFineWhat() {
  const { t } = useTranslation();
  return (f: { typeLabel?: string | null; reason?: string | null }) => fineWhat(f) ?? t('fines.fineFallback');
}

// ─── Consolidated overview (My + Team, with filters) ───────────────────────────

export default function FinesView() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [player, setPlayer] = useState<string>(user?.userId ?? 'all');
  const [year, setYear] = useState<string>('all');
  const [confirmPay, setConfirmPay] = useState(false);
  const [disputeId, setDisputeId] = useState<string | null>(null);
  const [disputeNote, setDisputeNote] = useState('');

  const { data: my } = useQuery<MyFinesData>({ queryKey: ['fines-my'], queryFn: () => api.get('/fines/my').then(r => r.data.data) });
  const { data: ledger } = useQuery<Fine[]>({ queryKey: ['fines-team'], queryFn: () => api.get('/fines').then(r => r.data.data) });

  const payAll = useMutation({
    mutationFn: () => api.post('/fines/pay-outstanding'),
    onSuccess: () => { setConfirmPay(false); qc.invalidateQueries({ queryKey: ['fines-my'] }); qc.invalidateQueries({ queryKey: ['fines-team'] }); qc.invalidateQueries({ queryKey: ['fines-summary'] }); },
  });
  const dispute = useMutation({
    mutationFn: (id: string) => api.post(`/fines/${id}/dispute`, { note: disputeNote }),
    onSuccess: () => { setDisputeId(null); setDisputeNote(''); qc.invalidateQueries({ queryKey: ['fines-team'] }); qc.invalidateQueries({ queryKey: ['fines-my'] }); },
  });

  const allFines = ledger ?? [];

  const playerOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const f of allFines) if (f.playerId) m.set(f.playerId, f.playerName ?? '');
    if (user) m.set(user.userId, user.name);
    return [...m.entries()]
      .map(([id, name]) => ({ id, name: id === user?.userId ? t('fines.youSuffix', { name }) : name }))
      .sort((a, b) => (a.id === user?.userId ? -1 : b.id === user?.userId ? 1 : a.name.localeCompare(b.name)));
  }, [allFines, user]);

  const years = useMemo(
    () => [...new Set(allFines.map(f => new Date(f.createdAt).getFullYear()))].sort((a, b) => b - a),
    [allFines],
  );

  const viewingMe = player === user?.userId;
  const viewingAll = player === 'all';

  const filtered = useMemo(() => allFines.filter(f =>
    (viewingAll || f.playerId === player) &&
    (year === 'all' || new Date(f.createdAt).getFullYear() === Number(year)),
  ), [allFines, player, year, viewingAll]);

  const totals = computeTotals(filtered);
  const standings = useMemo(() => (viewingAll ? computeStandings(filtered) : []), [filtered, viewingAll]);

  const myOutstanding = my?.totals.outstandingDkk ?? 0;

  if (!ledger || !my) return <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400 text-sm">{t('common.loading')}</div>;

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <select
          value={player}
          onChange={e => setPlayer(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green bg-white min-w-0"
        >
          <option value="all">{t('fines.allPlayers')}</option>
          {playerOptions.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select
          value={year}
          onChange={e => setYear(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green bg-white"
        >
          <option value="all">{t('fines.allYears')}</option>
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      {/* Totals (current filter scope) */}
      <div className="grid grid-cols-3 gap-3">
        {([
          ['outstanding', totals.outstanding, 'text-amber-600'],
          ['awaitingConfirm', totals.awaiting, 'text-blue-600'],
          ['paid', totals.paid, 'text-green-600'],
        ] as const).map(([key, val, color]) => (
          <div key={key} className="bg-white rounded-xl border border-gray-200 p-4 text-center">
            <p className={`text-xl sm:text-2xl font-bold ${color}`}>{kr(val)}</p>
            <p className="text-xs text-gray-500 mt-0.5">{t(`fines.${key}`)}</p>
          </div>
        ))}
      </div>

      {/* Pay action — only when looking at your own fines and you owe something */}
      {viewingMe && myOutstanding > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-gray-900">{t('fines.payTitle')}</p>
            <p className="text-sm text-gray-500">{t('fines.mobilePayBox')} <span className="font-semibold text-gray-700">{my.paymentInfo || '—'}</span> · {kr(myOutstanding)}</p>
          </div>
          <button onClick={() => setConfirmPay(true)} className="bg-brand-green hover:opacity-90 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors shrink-0">{t('fines.ivePaid')}</button>
        </div>
      )}

      {/* Standings (only for the All-players view) */}
      {viewingAll && standings.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-2">{t('fines.standings')}</h3>
          <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-50">
            {standings.map(p => (
              <button key={p.playerId} onClick={() => setPlayer(p.playerId)} className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50 transition-colors">
                <span className="text-sm font-medium text-gray-800">
                  {p.name}{p.playerId === user?.userId && <span className="text-brand-green ml-1 text-xs">{t('fines.you')}</span>}
                </span>
                <span className="text-sm">
                  {p.outstanding > 0 ? <span className="font-semibold text-amber-600">{t('fines.due', { amount: kr(p.outstanding) })}</span> : <span className="text-green-600">{t('fines.allPaid')}</span>}
                  <span className="text-gray-400 ml-2">· {t('fines.paidSuffix', { amount: kr(p.paid) })}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Ledger */}
      <FineCardsAndTable
        fines={filtered}
        showPlayer={viewingAll}
        rowAction={(f) =>
          f.playerId === user?.userId && f.status === 'approved'
            ? <button onClick={() => setDisputeId(f.fineId)} className="text-xs text-gray-400 hover:text-red-500 underline">{t('fines.dispute')}</button>
            : f.disputed ? <span className="text-xs text-red-500">{t('fines.disputed')}</span> : null
        }
        empty={viewingMe ? t('fines.emptyMine') : t('fines.emptyFiltered')}
      />

      {/* Confirm pay dialog */}
      {confirmPay && (
        <Dialog title={t('fines.confirmPayment')} onClose={() => setConfirmPay(false)}>
          <p className="text-sm text-gray-600">
            {t('fines.confirmPaymentBody', { amount: kr(myOutstanding), box: my.paymentInfo || '—' })}
          </p>
          {payAll.isError && <p className="text-sm text-red-500">{t('fines.somethingWrong')}</p>}
          <div className="flex justify-end gap-2">
            <button onClick={() => setConfirmPay(false)} className="text-sm text-gray-600 hover:bg-gray-50 px-4 py-2 rounded-lg">{t('common.cancel')}</button>
            <button onClick={() => payAll.mutate()} disabled={payAll.isPending} className="bg-brand-green text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50">
              {payAll.isPending ? t('fines.saving') : t('fines.yesIvePaid')}
            </button>
          </div>
        </Dialog>
      )}

      {/* Dispute dialog */}
      {disputeId && (
        <Dialog title={t('fines.disputeTitle')} onClose={() => setDisputeId(null)}>
          <p className="text-sm text-gray-600">{t('fines.disputeBody')}</p>
          <textarea value={disputeNote} onChange={e => setDisputeNote(e.target.value)} rows={3} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green" placeholder={t('fines.reasonPlaceholder')} />
          <div className="flex justify-end gap-2">
            <button onClick={() => setDisputeId(null)} className="text-sm text-gray-600 hover:bg-gray-50 px-4 py-2 rounded-lg">{t('common.cancel')}</button>
            <button onClick={() => dispute.mutate(disputeId)} disabled={dispute.isPending} className="bg-brand-dark text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50">{t('fines.submit')}</button>
          </div>
        </Dialog>
      )}
    </div>
  );
}

// ─── Manage (fine admins) — rendered on its own page ───────────────────────────

export function ManageFines() {
  const { t } = useTranslation();
  const { formatDate } = useDateFormat();
  const what = useFineWhat();
  const qc = useQueryClient();
  const [drillPlayer, setDrillPlayer] = useState<{ id: string; name: string } | null>(null);
  const [q, setQ] = useState('');
  const [showHelp, setShowHelp] = useState(false);
  const { data } = useQuery<AdminData>({ queryKey: ['fines-admin'], queryFn: () => api.get('/fines/admin').then(r => r.data.data) });
  const { data: ledger } = useQuery<Fine[]>({ queryKey: ['fines-team'], queryFn: () => api.get('/fines').then(r => r.data.data) });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['fines-admin'] });
    qc.invalidateQueries({ queryKey: ['fines-team'] });
    qc.invalidateQueries({ queryKey: ['fines-my'] });
    qc.invalidateQueries({ queryKey: ['fines-summary'] });
  };

  const approve = useMutation({ mutationFn: ({ id, ok }: { id: string; ok: boolean }) => api.put(`/fines/${id}/approve`, { approve: ok }), onSuccess: invalidate });
  const confirmPaid = useMutation({ mutationFn: (id: string) => api.put(`/fines/${id}/confirm-paid`), onSuccess: invalidate });
  const rejectClaim = useMutation({ mutationFn: (id: string) => api.put(`/fines/${id}/reject-claim`), onSuccess: invalidate });
  const voidFine = useMutation({ mutationFn: ({ id, reason }: { id: string; reason: string }) => api.put(`/fines/${id}/void`, { reason }), onSuccess: invalidate });

  if (!data) return <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400 text-sm">{t('common.loading')}</div>;

  const s = q.trim().toLowerCase();
  const matches = (name: string) => !s || name.toLowerCase().includes(s);
  const paymentClaimed = data.paymentClaimed.filter(f => matches(f.playerName ?? ''));
  const overview = data.overview.filter(p => matches(p.name));

  return (
    <div className="space-y-8">
      {/* Treasury */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
          <p className="text-xl sm:text-2xl font-bold text-green-600">{kr(data.treasury.collectedDkk)}</p>
          <p className="text-xs text-gray-500 mt-0.5">{t('fines.collected')}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
          <p className="text-xl sm:text-2xl font-bold text-amber-600">{kr(data.treasury.outstandingDkk)}</p>
          <p className="text-xs text-gray-500 mt-0.5">{t('fines.outstanding')}</p>
        </div>
      </div>

      {/* How-to for fine admins — collapsed by default to stay out of the way. */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <button
          onClick={() => setShowHelp(v => !v)}
          className="w-full flex items-center justify-between gap-2 px-4 py-3 text-left hover:bg-gray-50 transition-colors"
        >
          <span className="text-sm font-medium text-gray-700">{t('fines.howItWorks')}</span>
          <span className={`text-gray-400 transition-transform ${showHelp ? 'rotate-90' : ''}`}>›</span>
        </button>
        {showHelp && (
          <ol className="list-decimal pl-9 pr-4 pb-4 space-y-1.5 text-sm text-gray-600">
            <li>{t('fines.help1')} <span className="font-medium text-gray-700">{t('fines.help1b')}</span>.</li>
            <li>{t('fines.help2')}</li>
            <li>{t('fines.help3a')} <span className="font-medium text-gray-700">{t('fines.help3confirm')}</span>. {t('fines.help3b')} <span className="font-medium text-gray-700">{t('fines.help3notReceived')}</span> {t('fines.help3c')}</li>
            <li>{t('fines.help4a')} <span className="font-medium text-gray-700">{t('fines.help4owes')}</span> {t('fines.help4and')} <span className="font-medium text-gray-700">{t('fines.help4mark')}</span> {t('fines.help4b')}</li>
            <li>{t('fines.help5')}</li>
          </ol>
        )}
      </div>

      {/* Jump to a player by name to match an incoming MobilePay payment. */}
      <div>
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder={t('fines.searchPlayer')}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green"
        />
      </div>

      <IssueFineForm onDone={invalidate} />

      <Section title={t('fines.awaitingApproval', { count: data.pendingApproval.length })}>
        {data.pendingApproval.length === 0 ? <Empty>{t('fines.nothingToApprove')}</Empty> : (
          <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-50">
            {data.pendingApproval.map(f => (
              <div key={f.fineId} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{f.playerName} · {kr(f.amountDkk)}</p>
                  <p className="text-xs text-gray-500 truncate">{what(f)}{f.matchLabel ? ` · ${f.matchLabel}` : ''}</p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button onClick={() => approve.mutate({ id: f.fineId, ok: true })} className="text-xs font-medium bg-brand-green text-white px-3 py-1.5 rounded-lg">{t('fines.approve')}</button>
                  <button onClick={() => approve.mutate({ id: f.fineId, ok: false })} className="text-xs font-medium border border-gray-300 text-gray-600 hover:bg-gray-50 px-3 py-1.5 rounded-lg">{t('fines.reject')}</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title={t('fines.paymentsToConfirm', { count: paymentClaimed.length })}>
        {paymentClaimed.length === 0 ? <Empty>{s ? t('fines.noMatches') : t('fines.noPendingPayments')}</Empty> : (
          <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-50">
            {paymentClaimed.map(f => (
              <div key={f.fineId} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{f.playerName} · {kr(f.amountDkk)}</p>
                  <p className="text-xs text-gray-500 truncate">{what(f)} · {f.paidClaimedAt ? t('fines.claimedOn', { date: formatDate(f.paidClaimedAt, 'dayMonthYear') }) : ''}</p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button onClick={() => confirmPaid.mutate(f.fineId)} className="text-xs font-medium bg-brand-green text-white px-3 py-1.5 rounded-lg">{t('fines.confirm')}</button>
                  <button onClick={() => rejectClaim.mutate(f.fineId)} className="text-xs font-medium border border-gray-300 text-gray-600 hover:bg-gray-50 px-3 py-1.5 rounded-lg">{t('fines.notReceived')}</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title={t('fines.whoOwesWhat')}>
        {overview.length === 0 ? <Empty>{s ? t('fines.noMatches') : t('fines.noFinesYet')}</Empty> : (
          <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-50">
            {overview.map(p => (
              <button
                key={p.playerId}
                onClick={() => setDrillPlayer({ id: p.playerId, name: p.name })}
                className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{p.name}</p>
                  <p className="text-xs text-gray-500">
                    {p.outstandingDkk > 0 && <span className="text-amber-600">{t('fines.outstandingAmount', { amount: kr(p.outstandingDkk) })}</span>}
                    {p.claimedDkk > 0 && <span className="text-blue-600">{p.outstandingDkk > 0 ? ' · ' : ''}{t('fines.claimedAmount', { amount: kr(p.claimedDkk) })}</span>}
                    {p.outstandingDkk === 0 && p.claimedDkk === 0 && <span className="text-green-600">{t('fines.allSettled')}</span>}
                    <span className="text-gray-400"> · {t('fines.paidSuffix', { amount: kr(p.paidDkk) })}</span>
                  </p>
                </div>
                <span className="text-gray-300 shrink-0">›</span>
              </button>
            ))}
          </div>
        )}
      </Section>

      <PaymentInfoEditor current={data.paymentInfo} onDone={invalidate} />
      <FineTypeEditor onDone={invalidate} />

      {drillPlayer && (
        <PlayerFinesDialog
          playerName={drillPlayer.name}
          fines={(ledger ?? []).filter(f => f.playerId === drillPlayer.id)}
          onConfirmPaid={id => confirmPaid.mutate(id)}
          onVoid={(id, reason) => voidFine.mutate({ id, reason })}
          onClose={() => setDrillPlayer(null)}
        />
      )}
    </div>
  );
}

// ─── Per-player drill-down (fine admins) ───────────────────────────────────────

function PlayerFinesDialog({ playerName, fines, onConfirmPaid, onVoid, onClose }: {
  playerName: string;
  fines: Fine[];
  onConfirmPaid: (id: string) => void;
  onVoid: (id: string, reason: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { formatDate } = useDateFormat();
  const what = useFineWhat();
  const [voidingId, setVoidingId] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  // Outstanding first, then awaiting confirm, then paid, then the rest.
  const order: Record<string, number> = { approved: 0, payment_claimed: 1, paid: 2 };
  const sorted = [...fines].sort((a, b) => (order[a.status] ?? 3) - (order[b.status] ?? 3) || +new Date(b.createdAt) - +new Date(a.createdAt));

  return (
    <Dialog title={t('fines.playerFines', { name: playerName })} onClose={onClose} wide>
      {sorted.length === 0 ? (
        <p className="text-sm text-gray-400">{t('fines.noFines')}</p>
      ) : (
        <div className="space-y-2 max-h-[60vh] overflow-y-auto -mx-1 px-1">
          {sorted.map(f => (
            <div key={f.fineId} className="border border-gray-100 rounded-lg p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm text-gray-800">{what(f)}</p>
                  <p className="text-xs text-gray-400">{f.matchLabel ?? formatDate(f.createdAt, 'dayMonthYear')}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-bold text-gray-900">{kr(f.amountDkk)}</p>
                  <StatusBadge status={f.status} />
                </div>
              </div>

              {voidingId === f.fineId ? (
                <div className="mt-2 flex flex-col sm:flex-row gap-2">
                  <input
                    value={reason}
                    onChange={e => setReason(e.target.value)}
                    placeholder={t('fines.voidReasonPlaceholder')}
                    className="flex-1 min-w-0 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green"
                  />
                  <div className="flex gap-2 shrink-0">
                    <button onClick={() => { onVoid(f.fineId, reason); setVoidingId(null); setReason(''); }} className="text-xs font-medium bg-red-500 text-white px-3 py-1.5 rounded-lg">{t('fines.voidIt')}</button>
                    <button onClick={() => { setVoidingId(null); setReason(''); }} className="text-xs font-medium border border-gray-300 text-gray-600 hover:bg-gray-50 px-3 py-1.5 rounded-lg">{t('common.cancel')}</button>
                  </div>
                </div>
              ) : (f.status === 'approved' || f.status === 'payment_claimed') && (
                <div className="mt-2 flex gap-2 justify-end">
                  <button onClick={() => onConfirmPaid(f.fineId)} className="text-xs font-medium bg-brand-green text-white px-3 py-1.5 rounded-lg">
                    {f.status === 'approved' ? t('fines.markPaid') : t('fines.confirm')}
                  </button>
                  <button onClick={() => { setVoidingId(f.fineId); setReason(''); }} className="text-xs font-medium border border-gray-300 text-gray-600 hover:bg-gray-50 px-3 py-1.5 rounded-lg">{t('fines.void')}</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Dialog>
  );
}

// ─── Issue fine form ──────────────────────────────────────────────────────────

function IssueFineForm({ onDone }: { onDone: () => void }) {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [playerId, setPlayerId] = useState('');
  const [mode, setMode] = useState<'list' | 'custom'>('list');
  const [fineTypeId, setFineTypeId] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  const { data: types } = useQuery<FineType[]>({ queryKey: ['fine-types'], queryFn: () => api.get('/fine-types').then(r => r.data.data), enabled: open });
  const { data: players } = useQuery<PlayerLite[]>({ queryKey: ['players-lite'], queryFn: () => api.get('/players').then(r => r.data.data), enabled: open });

  // /players excludes the current user, so add a self option — a fine admin can fine themselves too.
  const playerOptions: PlayerLite[] = user ? [{ userId: user.userId, name: t('fines.youSuffix', { name: user.name }) }, ...(players ?? [])] : (players ?? []);

  const issue = useMutation({
    mutationFn: () => api.post('/fines', mode === 'list'
      ? { playerId, fineTypeId, reason: reason || null }
      : { playerId, amountDkk: Number(amount), reason }),
    onSuccess: () => { setOpen(false); setPlayerId(''); setFineTypeId(''); setAmount(''); setReason(''); setError(''); onDone(); },
    onError: (e: any) => setError(e?.response?.data?.error?.message ?? t('fines.issueFailed')),
  });

  const canSubmit = playerId && (mode === 'list' ? fineTypeId : (amount && reason.trim()));

  if (!open) return <button onClick={() => setOpen(true)} className="bg-brand-dark text-white text-sm font-medium px-4 py-2 rounded-lg">{t('fines.issueFine')}</button>;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-gray-900">{t('fines.issueFineTitle')}</h3>
        <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600 text-sm">✕</button>
      </div>

      <select value={playerId} onChange={e => setPlayerId(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green">
        <option value="">{t('fines.selectPlayer')}</option>
        {playerOptions.map(p => <option key={p.userId} value={p.userId}>{p.name}</option>)}
      </select>

      <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm w-fit">
        {(['list', 'custom'] as const).map((m, i) => (
          <button key={m} onClick={() => setMode(m)} className={`px-3 py-1.5 ${i > 0 ? 'border-l border-gray-200' : ''} ${mode === m ? 'bg-brand-green text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
            {m === 'list' ? t('fines.fromList') : t('fines.custom')}
          </button>
        ))}
      </div>

      {mode === 'list' ? (
        <select value={fineTypeId} onChange={e => setFineTypeId(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green">
          <option value="">{t('fines.selectFine')}</option>
          {(types ?? []).map(t => <option key={t.fineTypeId} value={t.fineTypeId}>{t.label} — {kr(t.amountDkk)}</option>)}
        </select>
      ) : (
        <input type="number" min="0" value={amount} onChange={e => setAmount(e.target.value)} placeholder={t('fines.amountPlaceholder')} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green" />
      )}

      <input value={reason} onChange={e => setReason(e.target.value)} placeholder={mode === 'custom' ? t('fines.reasonRequired') : t('fines.noteOptional')} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green" />

      {error && <p className="text-sm text-red-500">{error}</p>}
      <div className="flex justify-end gap-2">
        <button onClick={() => setOpen(false)} className="text-sm text-gray-600 hover:bg-gray-50 px-4 py-2 rounded-lg">{t('common.cancel')}</button>
        <button onClick={() => issue.mutate()} disabled={!canSubmit || issue.isPending} className="bg-brand-green text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50">
          {issue.isPending ? t('fines.issuing') : t('fines.issueFineSubmit')}
        </button>
      </div>
      <p className="text-xs text-gray-400">{t('fines.issueNote')}</p>
    </div>
  );
}

// ─── Payment info editor ──────────────────────────────────────────────────────

function PaymentInfoEditor({ current, onDone }: { current: string; onDone: () => void }) {
  const { t } = useTranslation();
  const [value, setValue] = useState(current);
  const save = useMutation({ mutationFn: () => api.put('/fines/payment-info', { paymentInfo: value }), onSuccess: onDone });
  return (
    <Section title={t('fines.mobilePayBox')}>
      <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col sm:flex-row sm:items-end gap-3">
        <div className="flex-1 min-w-0">
          <label className="text-xs text-gray-500">{t('fines.paymentInfoLabel')}</label>
          <input value={value} onChange={e => setValue(e.target.value)} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green" />
        </div>
        <button onClick={() => save.mutate()} disabled={save.isPending || value === current} className="bg-brand-dark text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50 shrink-0">
          {save.isPending ? t('fines.saving') : t('fines.save')}
        </button>
      </div>
    </Section>
  );
}

// ─── Fine type editor ─────────────────────────────────────────────────────────

function FineTypeEditor({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const { data: types } = useQuery<FineType[]>({ queryKey: ['fine-types-all'], queryFn: () => api.get('/fine-types?includeInactive=true').then(r => r.data.data), enabled: open });
  const [newLabel, setNewLabel] = useState('');
  const [newAmount, setNewAmount] = useState('');

  const refresh = () => { qc.invalidateQueries({ queryKey: ['fine-types-all'] }); qc.invalidateQueries({ queryKey: ['fine-types'] }); onDone(); };
  const create = useMutation({ mutationFn: () => api.post('/fine-types', { label: newLabel, amountDkk: Number(newAmount) }), onSuccess: () => { setNewLabel(''); setNewAmount(''); refresh(); } });
  const update = useMutation({ mutationFn: ({ id, patch }: { id: string; patch: any }) => api.put(`/fine-types/${id}`, patch), onSuccess: refresh });
  const remove = useMutation({ mutationFn: (id: string) => api.delete(`/fine-types/${id}`), onSuccess: refresh });

  return (
    <Section title={t('fines.fineTypes')}>
      {!open ? (
        <button onClick={() => setOpen(true)} className="text-sm text-brand-green font-medium hover:underline">{t('fines.editFineTypes')}</button>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
          <div className="space-y-2 max-h-72 overflow-y-auto">
            {(types ?? []).map(t => (
              <EditableType key={t.fineTypeId} type={t} onSave={(patch) => update.mutate({ id: t.fineTypeId, patch })} onDelete={() => remove.mutate(t.fineTypeId)} />
            ))}
          </div>
          <div className="flex gap-2 border-t border-gray-100 pt-3">
            <input value={newLabel} onChange={e => setNewLabel(e.target.value)} placeholder={t('fines.newFineLabel')} className="flex-1 min-w-0 border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            <input type="number" min="0" value={newAmount} onChange={e => setNewAmount(e.target.value)} placeholder={t('fines.dkk')} className="w-20 shrink-0 border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            <button onClick={() => create.mutate()} disabled={!newLabel.trim() || !newAmount || create.isPending} className="bg-brand-green text-white text-sm font-medium px-3 py-2 rounded-lg disabled:opacity-50 shrink-0">{t('fines.add')}</button>
          </div>
          <button onClick={() => setOpen(false)} className="text-sm text-gray-500 hover:underline">{t('common.close')}</button>
        </div>
      )}
    </Section>
  );
}

function EditableType({ type, onSave, onDelete }: { type: FineType; onSave: (patch: any) => void; onDelete: () => void }) {
  const { t } = useTranslation();
  const [label, setLabel] = useState(type.label);
  const [amount, setAmount] = useState(String(type.amountDkk));
  const dirty = label !== type.label || amount !== String(type.amountDkk);
  return (
    <div className={`flex items-center gap-2 ${type.active ? '' : 'opacity-50'}`}>
      <input value={label} onChange={e => setLabel(e.target.value)} className="flex-1 min-w-0 border border-gray-200 rounded-lg px-2 py-1.5 text-sm" />
      <input type="number" min="0" value={amount} onChange={e => setAmount(e.target.value)} className="w-16 shrink-0 border border-gray-200 rounded-lg px-2 py-1.5 text-sm" />
      {dirty && <button onClick={() => onSave({ label, amountDkk: Number(amount) })} className="text-xs text-brand-green font-medium shrink-0">{t('fines.save')}</button>}
      {type.active
        ? <button onClick={onDelete} className="text-xs text-gray-400 hover:text-red-500 shrink-0">{t('fines.disable')}</button>
        : <button onClick={() => onSave({ active: true })} className="text-xs text-gray-400 hover:text-brand-green shrink-0">{t('fines.enable')}</button>}
    </div>
  );
}

// ─── Shared bits ──────────────────────────────────────────────────────────────

function FineCardsAndTable({ fines, showPlayer, rowAction, empty }: {
  fines: Fine[]; showPlayer: boolean; rowAction?: (f: Fine) => React.ReactNode; empty: string;
}) {
  const { t } = useTranslation();
  const { formatDate } = useDateFormat();
  const what = useFineWhat();
  if (fines.length === 0) return <Empty>{empty}</Empty>;
  return (
    <>
      {/* Mobile cards */}
      <div className="sm:hidden space-y-2">
        {fines.map(f => (
          <div key={f.fineId} className="bg-white rounded-xl border border-gray-200 p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                {showPlayer && <p className="text-sm font-semibold text-gray-900 truncate">{f.playerName}</p>}
                <p className="text-sm text-gray-800">{what(f)}</p>
                <p className="text-xs text-gray-400">{f.matchLabel ?? formatDate(f.createdAt, 'dayMonthYear')}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-sm font-bold text-gray-900">{kr(f.amountDkk)}</p>
                <StatusBadge status={f.status} />
              </div>
            </div>
            {rowAction && <div className="mt-2 text-right">{rowAction(f)}</div>}
          </div>
        ))}
      </div>

      {/* Desktop table */}
      <div className="hidden sm:block bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-gray-100 bg-gray-50">
            <tr>
              {showPlayer && <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">{t('fines.colPlayer')}</th>}
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">{t('fines.colFine')}</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">{t('fines.colMatchDate')}</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">{t('fines.colAmount')}</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">{t('fines.colStatus')}</th>
              {rowAction && <th className="px-4 py-3" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {fines.map(f => (
              <tr key={f.fineId} className="hover:bg-gray-50">
                {showPlayer && <td className="px-4 py-3 font-medium text-gray-900">{f.playerName}</td>}
                <td className="px-4 py-3 text-gray-800">{what(f)}{f.reason && f.typeLabel ? <span className="text-gray-400"> · {f.reason}</span> : ''}</td>
                <td className="px-4 py-3 text-gray-500">{f.matchLabel ?? <span className="text-gray-400">{formatDate(f.createdAt, 'dayMonthYear')}</span>}</td>
                <td className="px-4 py-3 text-right font-semibold text-gray-900">{kr(f.amountDkk)}</td>
                <td className="px-4 py-3"><StatusBadge status={f.status} /></td>
                {rowAction && <td className="px-4 py-3 text-right">{rowAction(f)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-700 mb-2">{title}</h3>
      {children}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="bg-white rounded-xl border border-gray-200 p-6 text-center text-gray-400 text-sm">{children}</div>;
}

function Dialog({ title, children, onClose, wide }: { title: string; children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className={`bg-white rounded-2xl shadow-xl w-full ${wide ? 'max-w-lg' : 'max-w-sm'} p-6 space-y-4 boca-pop`} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-semibold text-gray-900">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-sm shrink-0">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}
