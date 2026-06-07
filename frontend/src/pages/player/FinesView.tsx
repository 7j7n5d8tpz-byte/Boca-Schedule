import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
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

const fmtDate = (s: string) => new Date(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

function StatusBadge({ status }: { status: FineStatus }) {
  const m = STATUS_META[status];
  return <span className={`text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${m.cls}`}>{m.label}</span>;
}

// ─── Consolidated overview (My + Team, with filters) ───────────────────────────

export default function FinesView() {
  const { user } = useAuth();
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
      .map(([id, name]) => ({ id, name: id === user?.userId ? `${name} (you)` : name }))
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

  if (!ledger || !my) return <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400 text-sm">Loading…</div>;

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <select
          value={player}
          onChange={e => setPlayer(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green bg-white min-w-0"
        >
          <option value="all">All players</option>
          {playerOptions.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select
          value={year}
          onChange={e => setYear(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green bg-white"
        >
          <option value="all">All years</option>
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      {/* Totals (current filter scope) */}
      <div className="grid grid-cols-3 gap-3">
        {[
          ['Outstanding', totals.outstanding, 'text-amber-600'],
          ['Awaiting confirm', totals.awaiting, 'text-blue-600'],
          ['Paid', totals.paid, 'text-green-600'],
        ].map(([label, val, color]) => (
          <div key={label as string} className="bg-white rounded-xl border border-gray-200 p-4 text-center">
            <p className={`text-xl sm:text-2xl font-bold ${color}`}>{kr(val as number)}</p>
            <p className="text-xs text-gray-500 mt-0.5">{label as string}</p>
          </div>
        ))}
      </div>

      {/* Pay action — only when looking at your own fines and you owe something */}
      {viewingMe && myOutstanding > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-gray-900">Pay your outstanding fines</p>
            <p className="text-sm text-gray-500">MobilePay box <span className="font-semibold text-gray-700">{my.paymentInfo || '—'}</span> · {kr(myOutstanding)}</p>
          </div>
          <button onClick={() => setConfirmPay(true)} className="bg-brand-green hover:opacity-90 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors shrink-0">I've paid</button>
        </div>
      )}

      {/* Standings (only for the All-players view) */}
      {viewingAll && standings.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">Standings</h3>
          <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-50">
            {standings.map(p => (
              <button key={p.playerId} onClick={() => setPlayer(p.playerId)} className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50 transition-colors">
                <span className="text-sm font-medium text-gray-800">
                  {p.name}{p.playerId === user?.userId && <span className="text-brand-green ml-1 text-xs">you</span>}
                </span>
                <span className="text-sm">
                  {p.outstanding > 0 ? <span className="font-semibold text-amber-600">{kr(p.outstanding)} due</span> : <span className="text-green-600">all paid</span>}
                  <span className="text-gray-400 ml-2">· {kr(p.paid)} paid</span>
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
            ? <button onClick={() => setDisputeId(f.fineId)} className="text-xs text-gray-400 hover:text-red-500 underline">Dispute</button>
            : f.disputed ? <span className="text-xs text-red-500">Disputed</span> : null
        }
        empty={viewingMe ? 'You have no fines. Keep it up!' : 'No fines for this filter.'}
      />

      {/* Confirm pay dialog */}
      {confirmPay && (
        <Dialog title="Confirm payment" onClose={() => setConfirmPay(false)}>
          <p className="text-sm text-gray-600">
            Pay <span className="font-semibold">{kr(myOutstanding)}</span> to MobilePay box <span className="font-semibold">{my.paymentInfo || '—'}</span>, then confirm below. A fine admin will verify and mark it paid.
          </p>
          {payAll.isError && <p className="text-sm text-red-500">Something went wrong. Try again.</p>}
          <div className="flex justify-end gap-2">
            <button onClick={() => setConfirmPay(false)} className="text-sm text-gray-600 hover:bg-gray-50 px-4 py-2 rounded-lg">Cancel</button>
            <button onClick={() => payAll.mutate()} disabled={payAll.isPending} className="bg-brand-green text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50">
              {payAll.isPending ? 'Saving…' : "Yes, I've paid"}
            </button>
          </div>
        </Dialog>
      )}

      {/* Dispute dialog */}
      {disputeId && (
        <Dialog title="Dispute this fine" onClose={() => setDisputeId(null)}>
          <p className="text-sm text-gray-600">Tell the fine admins why you think this fine is wrong. (Heads up: "Brok over tildelt bøde" is itself a fine 😉)</p>
          <textarea value={disputeNote} onChange={e => setDisputeNote(e.target.value)} rows={3} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green" placeholder="Reason…" />
          <div className="flex justify-end gap-2">
            <button onClick={() => setDisputeId(null)} className="text-sm text-gray-600 hover:bg-gray-50 px-4 py-2 rounded-lg">Cancel</button>
            <button onClick={() => dispute.mutate(disputeId)} disabled={dispute.isPending} className="bg-brand-dark text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50">Submit</button>
          </div>
        </Dialog>
      )}
    </div>
  );
}

// ─── Manage (fine admins) — rendered on its own page ───────────────────────────

export function ManageFines() {
  const qc = useQueryClient();
  const [drillPlayer, setDrillPlayer] = useState<{ id: string; name: string } | null>(null);
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

  if (!data) return <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400 text-sm">Loading…</div>;

  return (
    <div className="space-y-8">
      {/* Treasury */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
          <p className="text-xl sm:text-2xl font-bold text-green-600">{kr(data.treasury.collectedDkk)}</p>
          <p className="text-xs text-gray-500 mt-0.5">Collected</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
          <p className="text-xl sm:text-2xl font-bold text-amber-600">{kr(data.treasury.outstandingDkk)}</p>
          <p className="text-xs text-gray-500 mt-0.5">Outstanding</p>
        </div>
      </div>

      <IssueFineForm onDone={invalidate} />

      <Section title={`Awaiting approval (${data.pendingApproval.length})`}>
        {data.pendingApproval.length === 0 ? <Empty>Nothing to approve.</Empty> : (
          <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-50">
            {data.pendingApproval.map(f => (
              <div key={f.fineId} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{f.playerName} · {kr(f.amountDkk)}</p>
                  <p className="text-xs text-gray-500 truncate">{fineWhat(f)}{f.matchLabel ? ` · ${f.matchLabel}` : ''}</p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button onClick={() => approve.mutate({ id: f.fineId, ok: true })} className="text-xs font-medium bg-brand-green text-white px-3 py-1.5 rounded-lg">Approve</button>
                  <button onClick={() => approve.mutate({ id: f.fineId, ok: false })} className="text-xs font-medium border border-gray-300 text-gray-600 hover:bg-gray-50 px-3 py-1.5 rounded-lg">Reject</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title={`Payments to confirm (${data.paymentClaimed.length})`}>
        {data.paymentClaimed.length === 0 ? <Empty>No pending payments.</Empty> : (
          <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-50">
            {data.paymentClaimed.map(f => (
              <div key={f.fineId} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{f.playerName} · {kr(f.amountDkk)}</p>
                  <p className="text-xs text-gray-500 truncate">{fineWhat(f)} · claimed {f.paidClaimedAt ? fmtDate(f.paidClaimedAt) : ''}</p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button onClick={() => confirmPaid.mutate(f.fineId)} className="text-xs font-medium bg-brand-green text-white px-3 py-1.5 rounded-lg">Confirm</button>
                  <button onClick={() => rejectClaim.mutate(f.fineId)} className="text-xs font-medium border border-gray-300 text-gray-600 hover:bg-gray-50 px-3 py-1.5 rounded-lg">Not received</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Who owes what">
        {data.overview.length === 0 ? <Empty>No fines yet.</Empty> : (
          <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-50">
            {data.overview.map(p => (
              <button
                key={p.playerId}
                onClick={() => setDrillPlayer({ id: p.playerId, name: p.name })}
                className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{p.name}</p>
                  <p className="text-xs text-gray-500">
                    {p.outstandingDkk > 0 && <span className="text-amber-600">{kr(p.outstandingDkk)} outstanding</span>}
                    {p.claimedDkk > 0 && <span className="text-blue-600">{p.outstandingDkk > 0 ? ' · ' : ''}{kr(p.claimedDkk)} claimed</span>}
                    {p.outstandingDkk === 0 && p.claimedDkk === 0 && <span className="text-green-600">all settled</span>}
                    <span className="text-gray-400"> · {kr(p.paidDkk)} paid</span>
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
  const [voidingId, setVoidingId] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  // Outstanding first, then awaiting confirm, then paid, then the rest.
  const order: Record<string, number> = { approved: 0, payment_claimed: 1, paid: 2 };
  const sorted = [...fines].sort((a, b) => (order[a.status] ?? 3) - (order[b.status] ?? 3) || +new Date(b.createdAt) - +new Date(a.createdAt));

  return (
    <Dialog title={`${playerName} — fines`} onClose={onClose} wide>
      {sorted.length === 0 ? (
        <p className="text-sm text-gray-400">No fines.</p>
      ) : (
        <div className="space-y-2 max-h-[60vh] overflow-y-auto -mx-1 px-1">
          {sorted.map(f => (
            <div key={f.fineId} className="border border-gray-100 rounded-lg p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm text-gray-800">{fineWhat(f)}</p>
                  <p className="text-xs text-gray-400">{f.matchLabel ?? fmtDate(f.createdAt)}</p>
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
                    placeholder="Reason (optional)"
                    className="flex-1 min-w-0 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green"
                  />
                  <div className="flex gap-2 shrink-0">
                    <button onClick={() => { onVoid(f.fineId, reason); setVoidingId(null); setReason(''); }} className="text-xs font-medium bg-red-500 text-white px-3 py-1.5 rounded-lg">Void it</button>
                    <button onClick={() => { setVoidingId(null); setReason(''); }} className="text-xs font-medium border border-gray-300 text-gray-600 hover:bg-gray-50 px-3 py-1.5 rounded-lg">Cancel</button>
                  </div>
                </div>
              ) : (f.status === 'approved' || f.status === 'payment_claimed') && (
                <div className="mt-2 flex gap-2 justify-end">
                  <button onClick={() => onConfirmPaid(f.fineId)} className="text-xs font-medium bg-brand-green text-white px-3 py-1.5 rounded-lg">
                    {f.status === 'approved' ? 'Mark paid' : 'Confirm'}
                  </button>
                  <button onClick={() => { setVoidingId(f.fineId); setReason(''); }} className="text-xs font-medium border border-gray-300 text-gray-600 hover:bg-gray-50 px-3 py-1.5 rounded-lg">Void</button>
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
  const playerOptions: PlayerLite[] = user ? [{ userId: user.userId, name: `${user.name} (you)` }, ...(players ?? [])] : (players ?? []);

  const issue = useMutation({
    mutationFn: () => api.post('/fines', mode === 'list'
      ? { playerId, fineTypeId, reason: reason || null }
      : { playerId, amountDkk: Number(amount), reason }),
    onSuccess: () => { setOpen(false); setPlayerId(''); setFineTypeId(''); setAmount(''); setReason(''); setError(''); onDone(); },
    onError: (e: any) => setError(e?.response?.data?.error?.message ?? 'Failed to issue fine'),
  });

  const canSubmit = playerId && (mode === 'list' ? fineTypeId : (amount && reason.trim()));

  if (!open) return <button onClick={() => setOpen(true)} className="bg-brand-dark text-white text-sm font-medium px-4 py-2 rounded-lg">+ Issue a fine</button>;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-gray-900">Issue a fine</h3>
        <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600 text-sm">✕</button>
      </div>

      <select value={playerId} onChange={e => setPlayerId(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green">
        <option value="">Select player…</option>
        {playerOptions.map(p => <option key={p.userId} value={p.userId}>{p.name}</option>)}
      </select>

      <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm w-fit">
        {(['list', 'custom'] as const).map((m, i) => (
          <button key={m} onClick={() => setMode(m)} className={`px-3 py-1.5 ${i > 0 ? 'border-l border-gray-200' : ''} ${mode === m ? 'bg-brand-green text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
            {m === 'list' ? 'From list' : 'Custom'}
          </button>
        ))}
      </div>

      {mode === 'list' ? (
        <select value={fineTypeId} onChange={e => setFineTypeId(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green">
          <option value="">Select fine…</option>
          {(types ?? []).map(t => <option key={t.fineTypeId} value={t.fineTypeId}>{t.label} — {kr(t.amountDkk)}</option>)}
        </select>
      ) : (
        <input type="number" min="0" value={amount} onChange={e => setAmount(e.target.value)} placeholder="Amount (DKK)" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green" />
      )}

      <input value={reason} onChange={e => setReason(e.target.value)} placeholder={mode === 'custom' ? 'Reason (required)' : 'Note (optional)'} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green" />

      {error && <p className="text-sm text-red-500">{error}</p>}
      <div className="flex justify-end gap-2">
        <button onClick={() => setOpen(false)} className="text-sm text-gray-600 hover:bg-gray-50 px-4 py-2 rounded-lg">Cancel</button>
        <button onClick={() => issue.mutate()} disabled={!canSubmit || issue.isPending} className="bg-brand-green text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50">
          {issue.isPending ? 'Issuing…' : 'Issue fine'}
        </button>
      </div>
      <p className="text-xs text-gray-400">This fine is issued directly (auto-approved) and the player is notified.</p>
    </div>
  );
}

// ─── Payment info editor ──────────────────────────────────────────────────────

function PaymentInfoEditor({ current, onDone }: { current: string; onDone: () => void }) {
  const [value, setValue] = useState(current);
  const save = useMutation({ mutationFn: () => api.put('/fines/payment-info', { paymentInfo: value }), onSuccess: onDone });
  return (
    <Section title="MobilePay box">
      <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col sm:flex-row sm:items-end gap-3">
        <div className="flex-1 min-w-0">
          <label className="text-xs text-gray-500">Shown to players when they pay</label>
          <input value={value} onChange={e => setValue(e.target.value)} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green" />
        </div>
        <button onClick={() => save.mutate()} disabled={save.isPending || value === current} className="bg-brand-dark text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50 shrink-0">
          {save.isPending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </Section>
  );
}

// ─── Fine type editor ─────────────────────────────────────────────────────────

function FineTypeEditor({ onDone }: { onDone: () => void }) {
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
    <Section title="Fine types">
      {!open ? (
        <button onClick={() => setOpen(true)} className="text-sm text-brand-green font-medium hover:underline">Edit fine types →</button>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
          <div className="space-y-2 max-h-72 overflow-y-auto">
            {(types ?? []).map(t => (
              <EditableType key={t.fineTypeId} type={t} onSave={(patch) => update.mutate({ id: t.fineTypeId, patch })} onDelete={() => remove.mutate(t.fineTypeId)} />
            ))}
          </div>
          <div className="flex gap-2 border-t border-gray-100 pt-3">
            <input value={newLabel} onChange={e => setNewLabel(e.target.value)} placeholder="New fine label" className="flex-1 min-w-0 border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            <input type="number" min="0" value={newAmount} onChange={e => setNewAmount(e.target.value)} placeholder="DKK" className="w-20 shrink-0 border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            <button onClick={() => create.mutate()} disabled={!newLabel.trim() || !newAmount || create.isPending} className="bg-brand-green text-white text-sm font-medium px-3 py-2 rounded-lg disabled:opacity-50 shrink-0">Add</button>
          </div>
          <button onClick={() => setOpen(false)} className="text-sm text-gray-500 hover:underline">Close</button>
        </div>
      )}
    </Section>
  );
}

function EditableType({ type, onSave, onDelete }: { type: FineType; onSave: (patch: any) => void; onDelete: () => void }) {
  const [label, setLabel] = useState(type.label);
  const [amount, setAmount] = useState(String(type.amountDkk));
  const dirty = label !== type.label || amount !== String(type.amountDkk);
  return (
    <div className={`flex items-center gap-2 ${type.active ? '' : 'opacity-50'}`}>
      <input value={label} onChange={e => setLabel(e.target.value)} className="flex-1 min-w-0 border border-gray-200 rounded-lg px-2 py-1.5 text-sm" />
      <input type="number" min="0" value={amount} onChange={e => setAmount(e.target.value)} className="w-16 shrink-0 border border-gray-200 rounded-lg px-2 py-1.5 text-sm" />
      {dirty && <button onClick={() => onSave({ label, amountDkk: Number(amount) })} className="text-xs text-brand-green font-medium shrink-0">Save</button>}
      {type.active
        ? <button onClick={onDelete} className="text-xs text-gray-400 hover:text-red-500 shrink-0">Disable</button>
        : <button onClick={() => onSave({ active: true })} className="text-xs text-gray-400 hover:text-brand-green shrink-0">Enable</button>}
    </div>
  );
}

// ─── Shared bits ──────────────────────────────────────────────────────────────

function FineCardsAndTable({ fines, showPlayer, rowAction, empty }: {
  fines: Fine[]; showPlayer: boolean; rowAction?: (f: Fine) => React.ReactNode; empty: string;
}) {
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
                <p className="text-sm text-gray-800">{fineWhat(f)}</p>
                <p className="text-xs text-gray-400">{f.matchLabel ?? fmtDate(f.createdAt)}</p>
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
              {showPlayer && <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Player</th>}
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Fine</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Match / date</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Amount</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
              {rowAction && <th className="px-4 py-3" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {fines.map(f => (
              <tr key={f.fineId} className="hover:bg-gray-50">
                {showPlayer && <td className="px-4 py-3 font-medium text-gray-900">{f.playerName}</td>}
                <td className="px-4 py-3 text-gray-800">{fineWhat(f)}{f.reason && f.typeLabel ? <span className="text-gray-400"> · {f.reason}</span> : ''}</td>
                <td className="px-4 py-3 text-gray-500">{f.matchLabel ?? <span className="text-gray-400">{fmtDate(f.createdAt)}</span>}</td>
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
      <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">{title}</h3>
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
      <div className={`bg-white rounded-2xl shadow-xl w-full ${wide ? 'max-w-lg' : 'max-w-sm'} p-6 space-y-4`} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-semibold text-gray-900">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-sm shrink-0">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}
