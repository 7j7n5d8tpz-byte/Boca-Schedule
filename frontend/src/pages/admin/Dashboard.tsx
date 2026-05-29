import AppNav from '../components/AppNav';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import AppNav from '../../components/AppNav';

// ─── Types ───────────────────────────────────────────────────────────────────

interface AdminUser {
  userId: string;
  email: string;
  name: string;
  role: 'player' | 'coach' | 'admin';
  isActive: boolean;
  canEnterResults: boolean;
  createdAt: string;
  lastLogin: string | null;
}

interface HealthData {
  database: { status: string; message: string | null };
  api: { uptime: number; uptimeHuman: string };
  optimizationService: { status: string };
}

interface AuditLog {
  logId: string;
  userId: string | null;
  actorName: string;
  actorEmail: string;
  action: string;
  entityType: string;
  entityId: string | null;
  oldValues: object | null;
  newValues: object | null;
  createdAt: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const ROLE_COLORS: Record<string, string> = {
  admin:  'bg-purple-100 text-purple-700',
  coach:  'bg-blue-100 text-blue-700',
  player: 'bg-green-100 text-green-700',
};

const ACTION_COLORS: Record<string, string> = {
  user_created:    'bg-green-100 text-green-700',
  user_deleted:    'bg-red-100 text-red-700',
  role_changed:    'bg-blue-100 text-blue-700',
  user_activated:  'bg-green-100 text-green-600',
  user_deactivated:'bg-yellow-100 text-yellow-700',
  match_published: 'bg-purple-100 text-purple-700',
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtDatetime(iso: string) {
  return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

// ─── Users Tab ───────────────────────────────────────────────────────────────

function UsersTab({ inactiveCount }: { inactiveCount: number }) {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [showInactiveOnly, setShowInactiveOnly] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [createForm, setCreateForm] = useState({ name: '', email: '', password: '', role: 'player' as string });
  const [createError, setCreateError] = useState('');

  const params = new URLSearchParams();
  if (search) params.set('search', search);
  if (roleFilter) params.set('role', roleFilter);
  if (showInactiveOnly) params.set('isActive', 'false');
  params.set('limit', '100');

  const { data, isLoading } = useQuery<{ users: AdminUser[]; pagination: { total: number } }>({
    queryKey: ['admin-users', search, roleFilter, showInactiveOnly],
    queryFn: () => api.get(`/admin/users?${params}`).then(r => r.data.data),
  });

  const roleMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: string }) =>
      api.put(`/admin/users/${userId}/role`, { role }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-users'] }),
  });

  const activeMutation = useMutation({
    mutationFn: ({ userId, isActive }: { userId: string; isActive: boolean }) =>
      api.put(`/admin/users/${userId}/active`, { isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-users'] }),
  });

  const resultsMutation = useMutation({
    mutationFn: ({ userId, canEnterResults }: { userId: string; canEnterResults: boolean }) =>
      api.put(`/admin/users/${userId}/results-permission`, { canEnterResults }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-users'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (userId: string) => api.delete(`/admin/users/${userId}`),
    onSuccess: () => {
      setConfirmDelete(null);
      qc.invalidateQueries({ queryKey: ['admin-users'] });
    },
  });

  const createMutation = useMutation({
    mutationFn: () => api.post('/admin/users', createForm),
    onSuccess: () => {
      setShowCreate(false);
      setCreateForm({ name: '', email: '', password: '', role: 'player' });
      setCreateError('');
      qc.invalidateQueries({ queryKey: ['admin-users'] });
    },
    onError: (err: any) => {
      setCreateError(err.response?.data?.error?.message ?? 'Failed to create user');
    },
  });

  const users = data?.users ?? [];

  return (
    <div className="space-y-4">
      {/* Pending registrations banner */}
      {inactiveCount > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-center justify-between gap-4">
          <p className="text-sm text-amber-700">
            <span className="font-semibold">{inactiveCount} inactive {inactiveCount === 1 ? 'account' : 'accounts'}</span> — pending activation or deactivated.
          </p>
          <button
            onClick={() => setShowInactiveOnly(v => !v)}
            className="shrink-0 text-xs font-medium border border-amber-300 text-amber-700 hover:bg-amber-100 px-3 py-1.5 rounded-lg transition-colors"
          >
            {showInactiveOnly ? 'Show all' : 'Show only inactive'}
          </button>
        </div>
      )}

      {/* Controls */}
      <div className="flex flex-wrap gap-3 items-center justify-between">
        <div className="flex gap-2 flex-1 min-w-0">
          <input
            type="text"
            placeholder="Search name or email…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="flex-1 min-w-0 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green"
          />
          <select
            value={roleFilter}
            onChange={e => setRoleFilter(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green"
          >
            <option value="">All roles</option>
            <option value="player">Player</option>
            <option value="coach">Coach</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        <button
          onClick={() => setShowCreate(v => !v)}
          className="shrink-0 bg-brand-green hover:bg-brand-green-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          {showCreate ? 'Cancel' : '+ Add user'}
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-5 space-y-4">
          <h3 className="font-semibold text-gray-900">Create new user</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Full name</label>
              <input
                type="text"
                value={createForm.name}
                onChange={e => setCreateForm(f => ({ ...f, name: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Email</label>
              <input
                type="email"
                value={createForm.email}
                onChange={e => setCreateForm(f => ({ ...f, email: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Temporary password</label>
              <input
                type="text"
                value={createForm.password}
                onChange={e => setCreateForm(f => ({ ...f, password: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-green"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Role</label>
              <select
                value={createForm.role}
                onChange={e => setCreateForm(f => ({ ...f, role: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green"
              >
                <option value="player">Player</option>
                <option value="coach">Coach</option>
                <option value="admin">Admin</option>
              </select>
            </div>
          </div>
          {createError && <p className="text-sm text-red-600">{createError}</p>}
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => { setShowCreate(false); setCreateError(''); }}
              className="text-sm border border-gray-300 text-gray-600 hover:bg-gray-50 font-medium px-4 py-2 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => createMutation.mutate()}
              disabled={createMutation.isPending || !createForm.name || !createForm.email || !createForm.password}
              className="text-sm bg-brand-green hover:bg-brand-green-700 disabled:opacity-50 text-white font-medium px-4 py-2 rounded-lg transition-colors"
            >
              {createMutation.isPending ? 'Creating…' : 'Create user'}
            </button>
          </div>
        </div>
      )}

      {/* User count */}
      <p className="text-xs text-gray-400">{data?.pagination.total ?? 0} users</p>

      {/* Table */}
      {isLoading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-100 bg-gray-50">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Name</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Email</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Role</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Results</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Joined</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {users.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-6 text-center text-gray-400">No users found</td></tr>
              )}
              {users.map(u => (
                <tr key={u.userId} className={u.isActive ? '' : 'opacity-50'}>
                  <td className="px-4 py-3 font-medium text-gray-900">{u.name}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{u.email}</td>
                  <td className="px-4 py-3">
                    <select
                      value={u.role}
                      onChange={e => roleMutation.mutate({ userId: u.userId, role: e.target.value })}
                      className={`text-xs font-medium px-2 py-1 rounded-full border-0 cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand-green ${ROLE_COLORS[u.role]}`}
                    >
                      <option value="player">Player</option>
                      <option value="coach">Coach</option>
                      <option value="admin">Admin</option>
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => activeMutation.mutate({ userId: u.userId, isActive: !u.isActive })}
                      className={`text-xs font-medium px-2 py-1 rounded-full transition-colors ${
                        u.isActive
                          ? 'bg-green-50 text-green-700 hover:bg-green-100'
                          : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                      }`}
                    >
                      {u.isActive ? 'Active' : 'Inactive'}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    {u.role === 'coach' || u.role === 'admin' ? (
                      <span className="text-xs text-gray-300">Always</span>
                    ) : (
                      <button
                        onClick={() => resultsMutation.mutate({ userId: u.userId, canEnterResults: !u.canEnterResults })}
                        disabled={resultsMutation.isPending}
                        className={`text-xs font-medium px-2 py-1 rounded-full transition-colors disabled:opacity-50 ${
                          u.canEnterResults
                            ? 'bg-blue-50 text-blue-700 hover:bg-blue-100'
                            : 'bg-gray-100 text-gray-400 hover:bg-gray-200'
                        }`}
                      >
                        {u.canEnterResults ? 'Enabled' : 'Disabled'}
                      </button>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-400">{fmtDate(u.createdAt)}</td>
                  <td className="px-4 py-3 text-right">
                    {confirmDelete === u.userId ? (
                      <div className="flex items-center gap-2 justify-end">
                        <span className="text-xs text-red-600 font-medium">Delete?</span>
                        <button
                          onClick={() => deleteMutation.mutate(u.userId)}
                          disabled={deleteMutation.isPending}
                          className="text-xs bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-medium px-2 py-1 rounded transition-colors"
                        >
                          Yes
                        </button>
                        <button
                          onClick={() => setConfirmDelete(null)}
                          className="text-xs border border-gray-300 text-gray-500 hover:bg-gray-50 font-medium px-2 py-1 rounded transition-colors"
                        >
                          No
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmDelete(u.userId)}
                        className="text-xs text-red-400 hover:text-red-600 transition-colors"
                      >
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Health Tab ───────────────────────────────────────────────────────────────

function HealthTab() {
  const { data, isLoading, refetch, isFetching } = useQuery<HealthData>({
    queryKey: ['admin-health'],
    queryFn: () => api.get('/admin/system/health').then(r => r.data.data),
    refetchInterval: 30_000,
  });

  const { data: config } = useQuery<{ key: string; value: unknown; description: string; updatedAt: string }[]>({
    queryKey: ['admin-config'],
    queryFn: () => api.get('/admin/system/config').then(r => r.data.data),
  });

  function statusDot(status: string) {
    if (status === 'healthy') return <span className="inline-block w-2 h-2 rounded-full bg-green-500 mr-2" />;
    if (status === 'unhealthy') return <span className="inline-block w-2 h-2 rounded-full bg-red-500 mr-2" />;
    return <span className="inline-block w-2 h-2 rounded-full bg-gray-300 mr-2" />;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <h2 className="font-semibold text-gray-900">System health</h2>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="text-xs text-brand-green hover:underline disabled:opacity-50"
        >
          {isFetching ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {isLoading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : data ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Database</p>
            <p className="text-sm font-medium text-gray-900 flex items-center">
              {statusDot(data.database.status)}
              {data.database.status === 'healthy' ? 'Healthy' : 'Unhealthy'}
            </p>
            {data.database.message && <p className="text-xs text-red-500 mt-1">{data.database.message}</p>}
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">API Server</p>
            <p className="text-sm font-medium text-gray-900 flex items-center">
              {statusDot('healthy')}
              Online
            </p>
            <p className="text-xs text-gray-400 mt-1">Uptime: {data.api.uptimeHuman}</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Optimizer</p>
            <p className="text-sm font-medium text-gray-900 flex items-center">
              {statusDot(data.optimizationService.status === 'healthy' ? 'healthy' : 'unknown')}
              {data.optimizationService.status === 'healthy' ? 'Online' : 'Not configured'}
            </p>
          </div>
        </div>
      ) : null}

      {/* System config */}
      {config && config.length > 0 && (
        <div className="space-y-2">
          <h2 className="font-semibold text-gray-900">System configuration</h2>
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="border-b border-gray-100 bg-gray-50">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Key</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Value</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Description</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {config.map(c => (
                  <tr key={c.key}>
                    <td className="px-4 py-3 font-mono text-xs text-gray-700">{c.key}</td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-900">{JSON.stringify(c.value)}</td>
                    <td className="px-4 py-3 text-xs text-gray-500">{c.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Audit Log Tab ────────────────────────────────────────────────────────────

function AuditLogTab() {
  const [actionFilter, setActionFilter] = useState('');
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;

  const params = new URLSearchParams();
  if (actionFilter) params.set('action', actionFilter);
  params.set('limit', String(PAGE_SIZE));
  params.set('offset', String(page * PAGE_SIZE));

  const { data, isLoading } = useQuery<{ logs: AuditLog[]; pagination: { total: number } }>({
    queryKey: ['admin-audit-log', actionFilter, page],
    queryFn: () => api.get(`/admin/audit-log?${params}`).then(r => r.data.data),
  });

  const logs = data?.logs ?? [];
  const total = data?.pagination.total ?? 0;
  const pageCount = Math.ceil(total / PAGE_SIZE);

  const KNOWN_ACTIONS = ['user_created', 'user_deleted', 'role_changed', 'user_activated', 'user_deactivated', 'match_published'];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <select
          value={actionFilter}
          onChange={e => { setActionFilter(e.target.value); setPage(0); }}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green"
        >
          <option value="">All actions</option>
          {KNOWN_ACTIONS.map(a => (
            <option key={a} value={a}>{a.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</option>
          ))}
        </select>
        <p className="text-xs text-gray-400">{total} entries</p>
      </div>

      {isLoading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : logs.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400 text-sm">
          No audit log entries yet
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-100 bg-gray-50">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">When</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Actor</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Action</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Entity</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Changes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {logs.map(l => (
                <tr key={l.logId} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">{fmtDatetime(l.createdAt)}</td>
                  <td className="px-4 py-3">
                    <p className="text-sm font-medium text-gray-900">{l.actorName}</p>
                    <p className="text-xs text-gray-400">{l.actorEmail}</p>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${ACTION_COLORS[l.action] ?? 'bg-gray-100 text-gray-600'}`}>
                      {l.action.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">
                    <span className="font-medium">{l.entityType}</span>
                    {l.entityId && <span className="text-gray-300 ml-1">{l.entityId.slice(0, 8)}…</span>}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500 max-w-xs">
                    {l.newValues && Object.entries(l.newValues as Record<string, unknown>).map(([k, v]) => (
                      <span key={k} className="block">
                        <span className="text-gray-400">{k.replace(/_/g, ' ')}:</span>{' '}
                        <span className="font-medium text-gray-700">{String(v)}</span>
                      </span>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pageCount > 1 && (
        <div className="flex items-center gap-2 justify-end">
          <button
            onClick={() => setPage(p => Math.max(0, p - 1))}
            disabled={page === 0}
            className="text-sm border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-40 font-medium px-3 py-1.5 rounded-lg transition-colors"
          >
            ← Prev
          </button>
          <span className="text-sm text-gray-500">{page + 1} / {pageCount}</span>
          <button
            onClick={() => setPage(p => Math.min(pageCount - 1, p + 1))}
            disabled={page >= pageCount - 1}
            className="text-sm border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-40 font-medium px-3 py-1.5 rounded-lg transition-colors"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

type Tab = 'users' | 'health' | 'audit';

export default function AdminDashboard() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>('users');

  const { data: inactiveData } = useQuery<{ pagination: { total: number } }>({
    queryKey: ['admin-inactive-count'],
    queryFn: () => api.get('/admin/users?isActive=false&limit=1').then(r => r.data.data),
    refetchInterval: 60_000,
  });
  const inactiveCount = inactiveData?.pagination.total ?? 0;

  return (
    <div className="min-h-screen bg-gray-50 boca-page">
      <AppNav />

      <main className="max-w-5xl mx-auto px-4 py-8 space-y-6">
        <h1 className="text-2xl font-bold text-gray-900">Admin panel</h1>

        {/* Tabs */}
        <div className="flex gap-1 bg-white border border-gray-200 rounded-xl p-1 w-fit">
          {([
            ['users',  'Users'],
            ['health', 'System health'],
            ['audit',  'Audit log'],
          ] as [Tab, string][]).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`relative px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                tab === id
                  ? 'bg-brand-dark text-white'
                  : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              {label}
              {id === 'users' && inactiveCount > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] bg-amber-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1">
                  {inactiveCount}
                </span>
              )}
            </button>
          ))}
        </div>

        {tab === 'users'  && <UsersTab inactiveCount={inactiveCount} />}
        {tab === 'health' && <HealthTab />}
        {tab === 'audit'  && <AuditLogTab />}
      </main>
    </div>
  );
}
