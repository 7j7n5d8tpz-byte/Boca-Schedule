import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { useDateFormat } from '../../i18n/format';
import AppNav from '../../components/AppNav';

// ─── Types ───────────────────────────────────────────────────────────────────

interface AdminUser {
  userId: string;
  email: string;
  name: string;
  role: 'player' | 'coach' | 'admin';
  isActive: boolean;
  isPlaceholder: boolean;
  canEnterResults: boolean;
  isFineAdmin: boolean;
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

function useAdminDates() {
  const { formatDate } = useDateFormat();
  return {
    fmtDate: (iso: string) => formatDate(iso, 'dayMonthYear'),
    fmtDatetime: (iso: string) => formatDate(iso, 'dayMonthTime'),
  };
}

// ─── Users Tab ───────────────────────────────────────────────────────────────

function UsersTab({ inactiveCount }: { inactiveCount: number }) {
  const { t } = useTranslation();
  const { fmtDate } = useAdminDates();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [showInactiveOnly, setShowInactiveOnly] = useState(false);
  const [showPlaceholdersOnly, setShowPlaceholdersOnly] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [createForm, setCreateForm] = useState({ name: '', email: '', password: '', role: 'player' as string });
  const [createError, setCreateError] = useState('');
  const [mergeFor, setMergeFor] = useState<AdminUser | null>(null);
  const [mergeTarget, setMergeTarget] = useState('');
  const [mergeError, setMergeError] = useState('');

  const params = new URLSearchParams();
  if (search) params.set('search', search);
  if (roleFilter) params.set('role', roleFilter);
  if (showInactiveOnly) params.set('isActive', 'false');
  if (showPlaceholdersOnly) params.set('isPlaceholder', 'true');
  params.set('limit', '200');

  const { data, isLoading } = useQuery<{ users: AdminUser[]; pagination: { total: number } }>({
    queryKey: ['admin-users', search, roleFilter, showInactiveOnly, showPlaceholdersOnly],
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

  const fineAdminMutation = useMutation({
    mutationFn: ({ userId, isFineAdmin }: { userId: string; isFineAdmin: boolean }) =>
      api.put(`/admin/users/${userId}/fine-admin`, { isFineAdmin }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-users'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (userId: string) => api.delete(`/admin/users/${userId}`),
    onSuccess: () => {
      setConfirmDelete(null);
      qc.invalidateQueries({ queryKey: ['admin-users'] });
    },
  });

  // Candidate target accounts for a merge: real registered accounts only.
  const { data: mergeCandidatesData } = useQuery<{ users: AdminUser[] }>({
    queryKey: ['admin-users-merge-candidates'],
    queryFn: () => api.get('/admin/users?limit=500&isPlaceholder=false').then(r => r.data.data),
    enabled: !!mergeFor,
  });
  const mergeCandidates = (mergeCandidatesData?.users ?? [])
    .filter(u => u.userId !== mergeFor?.userId)
    .sort((a, b) => a.name.localeCompare(b.name));

  const mergeMutation = useMutation({
    mutationFn: ({ placeholderId, targetUserId }: { placeholderId: string; targetUserId: string }) =>
      api.post(`/admin/users/${placeholderId}/merge`, { targetUserId }),
    onSuccess: () => {
      setMergeFor(null); setMergeTarget(''); setMergeError('');
      qc.invalidateQueries({ queryKey: ['admin-users'] });
    },
    onError: (err: any) => setMergeError(err.response?.data?.error?.message ?? t('admin.mergeFailed')),
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
      setCreateError(err.response?.data?.error?.message ?? t('admin.createFailed'));
    },
  });

  const users = data?.users ?? [];

  return (
    <div className="space-y-4">
      {/* Pending registrations banner */}
      {inactiveCount > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-center justify-between gap-4">
          <p className="text-sm text-amber-700">
            <span className="font-semibold">{t('admin.inactiveAccounts', { count: inactiveCount })}</span> {t('admin.inactiveSuffix')}
          </p>
          <button
            onClick={() => setShowInactiveOnly(v => !v)}
            className="shrink-0 text-xs font-medium border border-amber-300 text-amber-700 hover:bg-amber-100 px-3 py-1.5 rounded-lg transition-colors"
          >
            {showInactiveOnly ? t('admin.showAll') : t('admin.showOnlyInactive')}
          </button>
        </div>
      )}

      {/* Controls */}
      <div className="flex flex-wrap gap-3 items-center justify-between">
        <div className="flex gap-2 flex-1 min-w-0">
          <input
            type="text"
            placeholder={t('admin.searchPlaceholder')}
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="flex-1 min-w-0 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green"
          />
          <select
            value={roleFilter}
            onChange={e => { setRoleFilter(e.target.value); setShowPlaceholdersOnly(false); }}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green"
          >
            <option value="">{t('admin.allRoles')}</option>
            <option value="player">{t('admin.roles.player')}</option>
            <option value="coach">{t('admin.roles.coach')}</option>
            <option value="admin">{t('admin.roles.admin')}</option>
          </select>
          <button
            onClick={() => { setShowPlaceholdersOnly(v => !v); setRoleFilter(''); setShowInactiveOnly(false); }}
            className={`shrink-0 text-xs font-medium px-3 py-2 rounded-lg border transition-colors ${
              showPlaceholdersOnly
                ? 'bg-amber-100 border-amber-300 text-amber-700'
                : 'border-gray-300 text-gray-600 hover:bg-gray-50'
            }`}
          >
            {t('admin.placeholders')}
          </button>
        </div>
        <button
          onClick={() => setShowCreate(v => !v)}
          className="shrink-0 bg-brand-green hover:bg-brand-green-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          {showCreate ? t('common.cancel') : t('admin.addUser')}
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-5 space-y-4">
          <h3 className="font-semibold text-gray-900">{t('admin.createNewUser')}</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="newUserName" className="block text-xs font-medium text-gray-500 mb-1">{t('admin.fullName')}</label>
              <input
                id="newUserName"
                type="text"
                value={createForm.name}
                onChange={e => setCreateForm(f => ({ ...f, name: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green"
              />
            </div>
            <div>
              <label htmlFor="newUserEmail" className="block text-xs font-medium text-gray-500 mb-1">{t('admin.email')}</label>
              <input
                id="newUserEmail"
                type="email"
                value={createForm.email}
                onChange={e => setCreateForm(f => ({ ...f, email: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green"
              />
            </div>
            <div>
              <label htmlFor="newUserPassword" className="block text-xs font-medium text-gray-500 mb-1">{t('admin.tempPassword')}</label>
              <input
                id="newUserPassword"
                type="text"
                value={createForm.password}
                onChange={e => setCreateForm(f => ({ ...f, password: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-green"
              />
            </div>
            <div>
              <label htmlFor="newUserRole" className="block text-xs font-medium text-gray-500 mb-1">{t('admin.role')}</label>
              <select
                id="newUserRole"
                value={createForm.role}
                onChange={e => setCreateForm(f => ({ ...f, role: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green"
              >
                <option value="player">{t('admin.roles.player')}</option>
                <option value="coach">{t('admin.roles.coach')}</option>
                <option value="admin">{t('admin.roles.admin')}</option>
              </select>
            </div>
          </div>
          {createError && <p className="text-sm text-red-600">{createError}</p>}
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => { setShowCreate(false); setCreateError(''); }}
              className="text-sm border border-gray-300 text-gray-600 hover:bg-gray-50 font-medium px-4 py-2 rounded-lg transition-colors"
            >
              {t('common.cancel')}
            </button>
            <button
              onClick={() => createMutation.mutate()}
              disabled={createMutation.isPending || !createForm.name || !createForm.email || !createForm.password}
              className="text-sm bg-brand-green hover:bg-brand-green-700 disabled:opacity-50 text-white font-medium px-4 py-2 rounded-lg transition-colors"
            >
              {createMutation.isPending ? t('admin.creating') : t('admin.createUser')}
            </button>
          </div>
        </div>
      )}

      {/* User count */}
      <p className="text-xs text-gray-400">{t('admin.usersCount', { count: data?.pagination.total ?? 0 })}</p>

      {/* Table */}
      {isLoading ? (
        <p className="text-sm text-gray-400">{t('common.loading')}</p>
      ) : (
        <>
        {/* Mobile cards */}
        <div className="sm:hidden space-y-3">
          {users.length === 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-6 text-center text-gray-400 text-sm">{t('admin.noUsersFound')}</div>
          )}
          {users.map(u => (
            <div key={u.userId} className={`bg-white rounded-xl border border-gray-200 p-4 space-y-3 ${u.isActive ? '' : 'opacity-50'}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-gray-900 truncate flex items-center gap-2">
                    {u.name}
                    {u.isPlaceholder && <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">{t('admin.placeholder')}</span>}
                  </p>
                  <p className="text-xs text-gray-500 truncate">{u.email}</p>
                </div>
                {u.isPlaceholder ? (
                  <button
                    onClick={() => { setMergeFor(u); setMergeTarget(''); setMergeError(''); }}
                    className="shrink-0 text-xs font-medium text-brand-green hover:text-brand-green-700 transition-colors"
                  >
                    {t('admin.mergeArrow')}
                  </button>
                ) : confirmDelete === u.userId ? (
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs text-red-600 font-medium">{t('admin.deleteQ')}</span>
                    <button
                      onClick={() => deleteMutation.mutate(u.userId)}
                      disabled={deleteMutation.isPending}
                      className="text-xs bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-medium px-2 py-1 rounded transition-colors"
                    >
                      {t('admin.yes')}
                    </button>
                    <button
                      onClick={() => setConfirmDelete(null)}
                      className="text-xs border border-gray-300 text-gray-500 hover:bg-gray-50 font-medium px-2 py-1 rounded transition-colors"
                    >
                      {t('admin.no')}
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmDelete(u.userId)}
                    className="shrink-0 text-xs text-red-400 hover:text-red-600 transition-colors"
                  >
                    {t('admin.delete')}
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor={`role-${u.userId}`} className="block text-xs text-gray-400 mb-1">{t('admin.role')}</label>
                  <select
                    id={`role-${u.userId}`}
                    value={u.role}
                    onChange={e => roleMutation.mutate({ userId: u.userId, role: e.target.value })}
                    className={`w-full text-xs font-medium px-2 py-1.5 rounded-lg border-0 cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand-green ${ROLE_COLORS[u.role]}`}
                  >
                    <option value="player">{t('admin.roles.player')}</option>
                    <option value="coach">{t('admin.roles.coach')}</option>
                    <option value="admin">{t('admin.roles.admin')}</option>
                  </select>
                </div>
                <div>
                  <span className="block text-xs text-gray-400 mb-1">{t('admin.status')}</span>
                  <button
                    aria-label={`${t('admin.status')}: ${u.isActive ? t('admin.active') : t('admin.inactive')}`}
                    aria-pressed={u.isActive}
                    onClick={() => activeMutation.mutate({ userId: u.userId, isActive: !u.isActive })}
                    className={`w-full text-xs font-medium px-2 py-1.5 rounded-lg transition-colors ${
                      u.isActive
                        ? 'bg-green-50 text-green-700 hover:bg-green-100'
                        : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                    }`}
                  >
                    {u.isActive ? t('admin.active') : t('admin.inactive')}
                  </button>
                </div>
                <div>
                  <span className="block text-xs text-gray-400 mb-1">{t('admin.results')}</span>
                  {u.role === 'coach' || u.role === 'admin' ? (
                    <p className="text-xs text-gray-300 py-1.5">{t('admin.always')}</p>
                  ) : (
                    <button
                      aria-label={`${t('admin.results')}: ${u.canEnterResults ? t('admin.enabled') : t('admin.disabled')}`}
                      aria-pressed={u.canEnterResults}
                      onClick={() => resultsMutation.mutate({ userId: u.userId, canEnterResults: !u.canEnterResults })}
                      disabled={resultsMutation.isPending}
                      className={`w-full text-xs font-medium px-2 py-1.5 rounded-lg transition-colors disabled:opacity-50 ${
                        u.canEnterResults
                          ? 'bg-blue-50 text-blue-700 hover:bg-blue-100'
                          : 'bg-gray-100 text-gray-400 hover:bg-gray-200'
                      }`}
                    >
                      {u.canEnterResults ? t('admin.enabled') : t('admin.disabled')}
                    </button>
                  )}
                </div>
                <div>
                  <span className="block text-xs text-gray-400 mb-1">{t('admin.fineAdmin')}</span>
                  {u.role === 'admin' ? (
                    <p className="text-xs text-gray-300 py-1.5">{t('admin.always')}</p>
                  ) : (
                    <button
                      aria-label={`${t('admin.fineAdmin')}: ${u.isFineAdmin ? t('admin.enabled') : t('admin.disabled')}`}
                      aria-pressed={u.isFineAdmin}
                      onClick={() => fineAdminMutation.mutate({ userId: u.userId, isFineAdmin: !u.isFineAdmin })}
                      disabled={fineAdminMutation.isPending}
                      className={`w-full text-xs font-medium px-2 py-1.5 rounded-lg transition-colors disabled:opacity-50 ${
                        u.isFineAdmin
                          ? 'bg-brand-green-50 text-brand-green hover:opacity-80'
                          : 'bg-gray-100 text-gray-400 hover:bg-gray-200'
                      }`}
                    >
                      {u.isFineAdmin ? t('admin.enabled') : t('admin.disabled')}
                    </button>
                  )}
                </div>
                <div>
                  <span className="block text-xs text-gray-400 mb-1">{t('admin.joined')}</span>
                  <p className="text-xs text-gray-500 py-1.5">{fmtDate(u.createdAt)}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Desktop table */}
        <div className="hidden sm:block bg-white rounded-xl border border-gray-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-100 bg-gray-50">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">{t('admin.name')}</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">{t('admin.role')}</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">{t('admin.status')}</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide hidden md:table-cell">{t('admin.results')}</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide hidden md:table-cell">{t('admin.fineAdmin')}</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide hidden lg:table-cell">{t('admin.joined')}</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {users.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-6 text-center text-gray-400">{t('admin.noUsersFound')}</td></tr>
              )}
              {users.map(u => (
                <tr key={u.userId} className={u.isActive ? '' : 'opacity-50'}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 font-medium text-gray-900">
                      <span className="truncate">{u.name}</span>
                      {u.isPlaceholder && (
                        <>
                          <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">{t('admin.placeholder')}</span>
                          <button
                            onClick={() => { setMergeFor(u); setMergeTarget(''); setMergeError(''); }}
                            className="shrink-0 text-xs font-medium text-brand-green hover:text-brand-green-700 transition-colors"
                          >
                            Merge →
                          </button>
                        </>
                      )}
                    </div>
                    <div className="text-xs text-gray-400 truncate">{u.email}</div>
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={u.role}
                      onChange={e => roleMutation.mutate({ userId: u.userId, role: e.target.value })}
                      className={`text-xs font-medium px-2 py-1 rounded-full border-0 cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand-green ${ROLE_COLORS[u.role]}`}
                    >
                      <option value="player">{t('admin.roles.player')}</option>
                      <option value="coach">{t('admin.roles.coach')}</option>
                      <option value="admin">{t('admin.roles.admin')}</option>
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
                      {u.isActive ? t('admin.active') : t('admin.inactive')}
                    </button>
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    {u.role === 'coach' || u.role === 'admin' ? (
                      <span className="text-xs text-gray-300">{t('admin.always')}</span>
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
                        {u.canEnterResults ? t('admin.enabled') : t('admin.disabled')}
                      </button>
                    )}
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    {u.role === 'admin' ? (
                      <span className="text-xs text-gray-300">{t('admin.always')}</span>
                    ) : (
                      <button
                        onClick={() => fineAdminMutation.mutate({ userId: u.userId, isFineAdmin: !u.isFineAdmin })}
                        disabled={fineAdminMutation.isPending}
                        className={`text-xs font-medium px-2 py-1 rounded-full transition-colors disabled:opacity-50 ${
                          u.isFineAdmin
                            ? 'bg-brand-green-50 text-brand-green hover:opacity-80'
                            : 'bg-gray-100 text-gray-400 hover:bg-gray-200'
                        }`}
                      >
                        {u.isFineAdmin ? t('admin.enabled') : t('admin.disabled')}
                      </button>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-400 hidden lg:table-cell">{fmtDate(u.createdAt)}</td>
                  <td className="px-4 py-3 text-right">
                    {u.isPlaceholder ? (
                      <span className="text-xs text-gray-300">—</span>
                    ) : confirmDelete === u.userId ? (
                      <div className="flex items-center gap-2 justify-end">
                        <span className="text-xs text-red-600 font-medium">{t('admin.deleteQ')}</span>
                        <button
                          onClick={() => deleteMutation.mutate(u.userId)}
                          disabled={deleteMutation.isPending}
                          className="text-xs bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-medium px-2 py-1 rounded transition-colors"
                        >
                          {t('admin.yes')}
                        </button>
                        <button
                          onClick={() => setConfirmDelete(null)}
                          className="text-xs border border-gray-300 text-gray-500 hover:bg-gray-50 font-medium px-2 py-1 rounded transition-colors"
                        >
                          {t('admin.no')}
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmDelete(u.userId)}
                        className="text-xs text-red-400 hover:text-red-600 transition-colors"
                      >
                        {t('admin.delete')}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}

      {/* Merge placeholder modal — portaled into <body> so it isn't anchored to
          the transformed .boca-page main / #root (see index.css), which would
          otherwise push it down the page instead of centering in the viewport. */}
      {mergeFor && createPortal(
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-[80] overflow-y-auto"
          onClick={() => setMergeFor(null)}
        >
          <div className="bg-white rounded-xl p-6 w-full max-w-md space-y-4" onClick={e => e.stopPropagation()}>
            <h3 className="font-semibold text-gray-900">{t('admin.mergePlaceholder')}</h3>
            <p className="text-sm text-gray-600">
              {t('admin.mergeBody1')} <span className="font-medium text-gray-900">{mergeFor.name}</span>{t('admin.mergeBody2')}
            </p>
            <div>
              <label htmlFor="mergeTarget" className="block text-xs font-medium text-gray-500 mb-1">{t('admin.mergeInto')}</label>
              <select
                id="mergeTarget"
                value={mergeTarget}
                onChange={e => setMergeTarget(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green"
              >
                <option value="">{t('admin.selectAccount')}</option>
                {mergeCandidates.map(c => (
                  <option key={c.userId} value={c.userId}>{c.name} ({c.email})</option>
                ))}
              </select>
              {mergeCandidates.length === 0 && (
                <p className="text-xs text-gray-400 mt-1">{t('admin.noMergeTargets')}</p>
              )}
            </div>
            {mergeError && <p className="text-sm text-red-600">{mergeError}</p>}
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setMergeFor(null)}
                className="text-sm border border-gray-300 text-gray-600 hover:bg-gray-50 font-medium px-4 py-2 rounded-lg transition-colors"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={() => mergeMutation.mutate({ placeholderId: mergeFor.userId, targetUserId: mergeTarget })}
                disabled={!mergeTarget || mergeMutation.isPending}
                className="text-sm bg-brand-green hover:bg-brand-green-700 disabled:opacity-50 text-white font-medium px-4 py-2 rounded-lg transition-colors"
              >
                {mergeMutation.isPending ? t('admin.merging') : t('admin.merge')}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

// ─── Health Tab ───────────────────────────────────────────────────────────────

function HealthTab() {
  const { t } = useTranslation();
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
        <h2 className="font-semibold text-gray-900">{t('admin.systemHealth')}</h2>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="text-xs text-brand-green hover:underline disabled:opacity-50"
        >
          {isFetching ? t('admin.refreshing') : t('admin.refresh')}
        </button>
      </div>

      {isLoading ? (
        <p className="text-sm text-gray-400">{t('common.loading')}</p>
      ) : data ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">{t('admin.database')}</p>
            <p className="text-sm font-medium text-gray-900 flex items-center">
              {statusDot(data.database.status)}
              {data.database.status === 'healthy' ? t('admin.healthy') : t('admin.unhealthy')}
            </p>
            {data.database.message && <p className="text-xs text-red-500 mt-1">{data.database.message}</p>}
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">{t('admin.apiServer')}</p>
            <p className="text-sm font-medium text-gray-900 flex items-center">
              {statusDot('healthy')}
              {t('admin.online')}
            </p>
            <p className="text-xs text-gray-400 mt-1">{t('admin.uptime', { value: data.api.uptimeHuman })}</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">{t('admin.optimizer')}</p>
            <p className="text-sm font-medium text-gray-900 flex items-center">
              {statusDot(data.optimizationService.status === 'healthy' ? 'healthy' : data.optimizationService.status === 'unhealthy' ? 'unhealthy' : 'unknown')}
              {data.optimizationService.status === 'healthy' ? t('admin.online') : data.optimizationService.status === 'unhealthy' ? t('admin.offline') : t('admin.notConfigured')}
            </p>
          </div>
        </div>
      ) : null}

      {/* System config */}
      {config && config.length > 0 && (
        <div className="space-y-2">
          <h2 className="font-semibold text-gray-900">{t('admin.systemConfig')}</h2>

          {/* Mobile cards */}
          <div className="sm:hidden space-y-3">
            {config.map(c => (
              <div key={c.key} className="bg-white rounded-xl border border-gray-200 p-4 space-y-1">
                <p className="font-mono text-xs text-gray-700 break-all">{c.key}</p>
                <p className="font-mono text-xs text-gray-900 break-all">{JSON.stringify(c.value)}</p>
                {c.description && <p className="text-xs text-gray-500">{c.description}</p>}
              </div>
            ))}
          </div>

          {/* Desktop table */}
          <div className="hidden sm:block bg-white rounded-xl border border-gray-200 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-gray-100 bg-gray-50">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">{t('admin.key')}</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">{t('admin.value')}</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">{t('admin.description')}</th>
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
  const { t } = useTranslation();
  const { fmtDatetime } = useAdminDates();
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
          <option value="">{t('admin.allActions')}</option>
          {KNOWN_ACTIONS.map(a => (
            <option key={a} value={a}>{a.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</option>
          ))}
        </select>
        <p className="text-xs text-gray-400">{t('admin.entriesCount', { count: total })}</p>
      </div>

      {isLoading ? (
        <p className="text-sm text-gray-400">{t('common.loading')}</p>
      ) : logs.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400 text-sm">
          {t('admin.noAuditEntries')}
        </div>
      ) : (
        <>
        {/* Mobile cards */}
        <div className="sm:hidden space-y-3">
          {logs.map(l => (
            <div key={l.logId} className="bg-white rounded-xl border border-gray-200 p-4 space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{l.actorName}</p>
                  <p className="text-xs text-gray-400 truncate">{l.actorEmail}</p>
                </div>
                <span className={`shrink-0 text-xs font-medium px-2 py-0.5 rounded-full ${ACTION_COLORS[l.action] ?? 'bg-gray-100 text-gray-600'}`}>
                  {l.action.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                </span>
              </div>
              <p className="text-xs text-gray-400">{fmtDatetime(l.createdAt)}</p>
              <p className="text-xs text-gray-500">
                <span className="font-medium">{l.entityType}</span>
                {l.entityId && <span className="text-gray-300 ml-1">{l.entityId.slice(0, 8)}…</span>}
              </p>
              {l.newValues && Object.entries(l.newValues as Record<string, unknown>).length > 0 && (
                <div className="text-xs text-gray-500 border-t border-gray-50 pt-2">
                  {Object.entries(l.newValues as Record<string, unknown>).map(([k, v]) => (
                    <span key={k} className="block">
                      <span className="text-gray-400">{k.replace(/_/g, ' ')}:</span>{' '}
                      <span className="font-medium text-gray-700">{String(v)}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Desktop table */}
        <div className="hidden sm:block bg-white rounded-xl border border-gray-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-100 bg-gray-50">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">{t('admin.when')}</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">{t('admin.actor')}</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">{t('admin.action')}</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">{t('admin.entity')}</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">{t('admin.changes')}</th>
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
        </>
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
  const { t } = useTranslation();
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
        <h1 className="text-2xl font-extrabold text-gray-900">{t('admin.title')}</h1>

        {/* Tabs */}
        <div className="flex gap-1 bg-white border border-gray-200 rounded-xl p-1 w-fit">
          {([
            ['users',  t('admin.tabUsers')],
            ['health', t('admin.tabHealth')],
            ['audit',  t('admin.tabAudit')],
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
