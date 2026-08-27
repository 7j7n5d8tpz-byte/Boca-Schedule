import AppNav from '../../components/AppNav';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { LANGUAGES, type Language } from '../../i18n';
import AvatarCropper from '../../components/AvatarCropper';

function PasswordStrength({ password }: { password: string }) {
  const { t } = useTranslation();
  const checks = [
    { label: t('password.min8'), ok: password.length >= 8 },
    { label: t('password.uppercase'), ok: /[A-Z]/.test(password) },
    { label: t('password.number'), ok: /[0-9]/.test(password) },
    { label: t('password.special'), ok: /[!@#$%^&*]/.test(password) },
  ];
  const score = checks.filter(c => c.ok).length;
  const colors = ['bg-red-400', 'bg-orange-400', 'bg-yellow-400', 'bg-green-500'];
  if (!password) return null;
  return (
    <div className="mt-2 space-y-2">
      <div className="flex gap-1">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className={`h-1 flex-1 rounded-full transition-colors ${i < score ? colors[score - 1] : 'bg-gray-200'}`} />
        ))}
      </div>
      <ul className="grid grid-cols-2 gap-x-4 gap-y-0.5">
        {checks.map(c => (
          <li key={c.label} className={`text-xs flex items-center gap-1 ${c.ok ? 'text-green-600' : 'text-gray-400'}`}>
            <span>{c.ok ? '✓' : '○'}</span> {c.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

type Position = 'GK' | 'DEF' | 'WIN' | 'MID' | 'STR';

const ALL_POSITIONS: Position[] = ['GK', 'DEF', 'WIN', 'MID', 'STR'];

const POS_COLOR: Record<string, string> = {
  GK:  'bg-yellow-100 text-yellow-700 border-yellow-300',
  DEF: 'bg-blue-100 text-blue-700 border-blue-300',
  WIN: 'bg-green-100 text-green-700 border-green-300',
  MID: 'bg-purple-100 text-purple-700 border-purple-300',
  STR: 'bg-red-100 text-red-700 border-red-300',
};

export default function Settings() {
  const { user, updateUser } = useAuth();
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const [avatarError, setAvatarError] = useState('');

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [positions, setPositions] = useState<Position[]>([]);
  const [saveError, setSaveError] = useState('');

  const [changingPassword, setChangingPassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState(false);

  const { data, isLoading } = useQuery<any>({
    queryKey: ['player-stats', user?.userId],
    queryFn: () => api.get(`/players/${user!.userId}/statistics`).then(r => r.data.data),
    enabled: !!user,
    onSuccess: (d: any) => {
      if (!editing) {
        setName(d.player.name);
        setPositions(d.player.preferredPositions ?? []);
      }
    },
  } as any);

  const { data: calendar } = useQuery<{ token: string; path: string }>({
    queryKey: ['calendar-me'],
    queryFn: () => api.get('/calendar/me').then(r => r.data.data),
    enabled: !!user,
  });
  const [copied, setCopied] = useState(false);
  const feedUrl = calendar ? `${window.location.origin}${calendar.path}` : '';

  const saveMutation = useMutation({
    mutationFn: () =>
      api.put(`/players/${user!.userId}/profile`, {
        name: name.trim() || undefined,
        preferredPositions: positions,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['player-stats', user?.userId] });
      setSaveError('');
      setEditing(false);
    },
    onError: (err: any) => {
      setSaveError(err.response?.data?.error?.message ?? t('settings.saveFailed'));
    },
  });

  const avatarMutation = useMutation({
    mutationFn: (image: string) =>
      api.put(`/players/${user!.userId}/avatar`, { image }).then(r => r.data.data.avatarUrl as string),
    onSuccess: (avatarUrl) => {
      updateUser({ avatarUrl });
      setCropSrc(null);
      setAvatarError('');
    },
    onError: (err: any) => setAvatarError(err.response?.data?.error?.message ?? t('settings.uploadFailed')),
  });

  const [languageError, setLanguageError] = useState('');
  const languageMutation = useMutation({
    mutationFn: (lang: Language) =>
      api.put(`/players/${user!.userId}/profile`, { language: lang }).then(() => lang),
    onSuccess: (lang) => { updateUser({ language: lang }); setLanguageError(''); },
    onError: (err: any) => setLanguageError(err.response?.data?.error?.message ?? t('settings.language.error')),
  });

  const removeAvatarMutation = useMutation({
    mutationFn: () => api.delete(`/players/${user!.userId}/avatar`),
    onSuccess: () => { updateUser({ avatarUrl: null }); setAvatarError(''); },
    onError: (err: any) => setAvatarError(err.response?.data?.error?.message ?? t('settings.removeFailed')),
  });

  function onFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file
    if (!file) return;
    if (!file.type.startsWith('image/')) { setAvatarError(t('common.chooseImageFile')); return; }
    const reader = new FileReader();
    reader.onload = () => setCropSrc(reader.result as string);
    reader.readAsDataURL(file);
  }

  const changePasswordMutation = useMutation({
    mutationFn: () => api.put('/auth/change-password', { currentPassword, newPassword }),
    onSuccess: () => {
      setPasswordSuccess(true);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordError('');
    },
    onError: (err: any) => {
      setPasswordError(err.response?.data?.error?.message ?? t('settings.updateFailed'));
    },
  });

  function submitPasswordChange() {
    if (!currentPassword) { setPasswordError(t('settings.enterCurrentPassword')); return; }
    if (newPassword.length < 8 || !/[A-Z]/.test(newPassword) || !/[0-9]/.test(newPassword) || !/[!@#$%^&*]/.test(newPassword)) {
      setPasswordError(t('settings.passwordRequirements'));
      return;
    }
    if (newPassword !== confirmPassword) { setPasswordError(t('auth.passwordsDoNotMatch')); return; }
    setPasswordError('');
    changePasswordMutation.mutate();
  }

  function togglePosition(pos: Position) {
    setPositions(prev =>
      prev.includes(pos) ? prev.filter(p => p !== pos) : [...prev, pos]
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 boca-page">
      <AppNav />

      <main className="max-w-2xl mx-auto px-4 py-8 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-extrabold text-gray-900">{t('settings.title')}</h1>
          {!editing && (
            <button
              onClick={() => setEditing(true)}
              className="text-sm text-brand-green hover:underline"
            >
              {t('settings.edit')}
            </button>
          )}
        </div>

        {/* Profile card */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          {/* Avatar */}
          <div className="flex items-center gap-4">
            <span className="w-20 h-20 rounded-full overflow-hidden bg-brand-green/15 text-brand-green text-2xl font-bold flex items-center justify-center shrink-0 ring-1 ring-gray-200">
              {user?.avatarUrl
                ? <img src={user.avatarUrl} alt="" className="w-full h-full object-cover" />
                : (user?.name?.charAt(0).toUpperCase() ?? '?')}
            </span>
            <div className="space-y-1">
              <div className="flex gap-3">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="text-sm font-medium text-brand-green hover:underline"
                >
                  {user?.avatarUrl ? t('settings.changePhoto') : t('settings.addPhoto')}
                </button>
                {user?.avatarUrl && (
                  <button
                    onClick={() => removeAvatarMutation.mutate()}
                    disabled={removeAvatarMutation.isPending}
                    className="text-sm text-gray-400 hover:text-red-500 disabled:opacity-50"
                  >
                    {t('common.remove')}
                  </button>
                )}
              </div>
              <p className="text-xs text-gray-400">{t('settings.photoHint')}</p>
              {avatarError && <p className="text-xs text-red-500">{avatarError}</p>}
            </div>
            <input ref={fileInputRef} type="file" accept="image/*" onChange={onFilePicked} className="hidden" />
          </div>

          <div className="h-px bg-gray-100" />

          {isLoading && <p className="text-sm text-gray-400">{t('common.loading')}</p>}

          {!isLoading && data && (
            <>
              {editing ? (
                <div className="space-y-4">
                  <div>
                    <label htmlFor="profileName" className="block text-sm font-medium text-gray-700 mb-1">{t('settings.name')}</label>
                    <input
                      id="profileName"
                      value={name}
                      onChange={e => setName(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green"
                    />
                  </div>
                  <div>
                    <span id="positions-label" className="block text-sm font-medium text-gray-700 mb-2">{t('settings.preferredPositions')}</span>
                    <div role="group" aria-labelledby="positions-label" className="flex gap-2 flex-wrap">
                      {ALL_POSITIONS.map(pos => (
                        <button
                          key={pos}
                          onClick={() => togglePosition(pos)}
                          className={`text-sm font-medium px-3 py-1.5 rounded-full border transition-colors ${
                            positions.includes(pos)
                              ? POS_COLOR[pos]
                              : 'bg-gray-50 border-gray-200 text-gray-500'
                          }`}
                        >
                          {pos}
                        </button>
                      ))}
                    </div>
                  </div>
                  {saveError && <p className="text-sm text-red-500">{saveError}</p>}
                  <div className="flex gap-2">
                    <button
                      onClick={() => saveMutation.mutate()}
                      disabled={saveMutation.isPending}
                      className="bg-brand-green hover:bg-brand-green-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
                    >
                      {saveMutation.isPending ? t('settings.saving') : t('settings.saveChanges')}
                    </button>
                    <button
                      onClick={() => setEditing(false)}
                      className="text-sm text-gray-500 hover:text-gray-700 px-4 py-2"
                    >
                      {t('common.cancel')}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-lg font-semibold text-gray-900">{data.player.name}</p>
                  <p className="text-sm text-gray-500">{user?.email}</p>
                  <div className="flex gap-1.5 flex-wrap mt-2">
                    {(data.player.preferredPositions ?? []).map((pos: string) => (
                      <span key={pos} className={`text-xs font-medium px-2 py-0.5 rounded-full border ${POS_COLOR[pos] ?? 'bg-gray-100 text-gray-500 border-gray-200'}`}>
                        {pos}
                      </span>
                    ))}
                    {(data.player.preferredPositions ?? []).length === 0 && (
                      <span className="text-sm text-gray-400">{t('settings.noPositions')}</span>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Change password */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <button
            onClick={() => { setChangingPassword(p => !p); setPasswordError(''); setPasswordSuccess(false); }}
            className="w-full flex items-center justify-between text-sm font-medium text-gray-700 hover:text-gray-900"
          >
            <span>{t('settings.changePassword')}</span>
            <span className="text-gray-400">{changingPassword ? '▲' : '▼'}</span>
          </button>

          {changingPassword && (
            <div className="mt-4 space-y-4">
              {passwordSuccess ? (
                <div className="bg-green-50 border border-green-200 text-green-700 rounded-lg px-4 py-3 text-sm">
                  {t('settings.passwordUpdated')}
                  <button onClick={() => { setChangingPassword(false); setPasswordSuccess(false); }} className="ml-2 underline">{t('common.close')}</button>
                </div>
              ) : (
                <>
                  <div>
                    <label htmlFor="currentPassword" className="block text-sm font-medium text-gray-700 mb-1">{t('settings.currentPassword')}</label>
                    <input
                      id="currentPassword"
                      type="password"
                      autoComplete="current-password"
                      value={currentPassword}
                      onChange={e => setCurrentPassword(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green"
                      placeholder="••••••••"
                    />
                  </div>
                  <div>
                    <label htmlFor="newPassword" className="block text-sm font-medium text-gray-700 mb-1">{t('settings.newPassword')}</label>
                    <input
                      id="newPassword"
                      type="password"
                      autoComplete="new-password"
                      value={newPassword}
                      onChange={e => setNewPassword(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green"
                      placeholder="••••••••"
                    />
                    <PasswordStrength password={newPassword} />
                  </div>
                  <div>
                    <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700 mb-1">{t('settings.confirmNewPassword')}</label>
                    <input
                      id="confirmPassword"
                      type="password"
                      autoComplete="new-password"
                      value={confirmPassword}
                      onChange={e => setConfirmPassword(e.target.value)}
                      className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green ${
                        confirmPassword && confirmPassword !== newPassword ? 'border-red-300 bg-red-50' : 'border-gray-300'
                      }`}
                      placeholder="••••••••"
                    />
                    {confirmPassword && confirmPassword !== newPassword && (
                      <p className="text-xs text-red-500 mt-1">{t('auth.passwordsDoNotMatchShort')}</p>
                    )}
                  </div>
                  {passwordError && <p className="text-sm text-red-500">{passwordError}</p>}
                  <div className="flex gap-2">
                    <button
                      onClick={submitPasswordChange}
                      disabled={changePasswordMutation.isPending}
                      className="bg-brand-green hover:bg-brand-green-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
                    >
                      {changePasswordMutation.isPending ? t('settings.updating') : t('settings.updatePassword')}
                    </button>
                    <button
                      onClick={() => { setChangingPassword(false); setCurrentPassword(''); setNewPassword(''); setConfirmPassword(''); setPasswordError(''); }}
                      className="text-sm text-gray-500 hover:text-gray-700 px-4 py-2"
                    >
                      {t('common.cancel')}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Calendar subscription */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
          <div>
            <p className="text-sm font-medium text-gray-900">{t('settings.calendar.title')}</p>
            <p className="text-xs text-gray-400 mt-0.5">
              {t('settings.calendar.help')}
            </p>
          </div>
          {feedUrl && (
            <>
              <div className="flex gap-2">
                <input
                  readOnly
                  value={feedUrl}
                  onFocus={e => e.currentTarget.select()}
                  className="flex-1 min-w-0 border border-gray-300 rounded-lg px-3 py-2 text-xs font-mono text-gray-600 focus:outline-none focus:ring-2 focus:ring-brand-green"
                />
                <button
                  onClick={async () => { await navigator.clipboard.writeText(feedUrl); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
                  className="shrink-0 text-xs font-medium border border-gray-300 text-gray-600 hover:bg-gray-50 px-3 py-2 rounded-lg transition-colors"
                >
                  {copied ? t('settings.calendar.copied') : t('settings.calendar.copy')}
                </button>
              </div>
              <a
                href={feedUrl.replace(/^https?:/, 'webcal:')}
                className="inline-block text-xs font-medium text-brand-green hover:underline"
              >
                {t('settings.calendar.addToApp')}
              </a>
            </>
          )}
        </div>

        {/* Language */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
          <div>
            <p className="text-sm font-medium text-gray-900">{t('settings.language.title')}</p>
            <p className="text-xs text-gray-400 mt-0.5">{t('settings.language.help')}</p>
          </div>
          <div className="flex gap-2">
            {LANGUAGES.map(lang => {
              const active = i18n.language === lang;
              return (
                <button
                  key={lang}
                  onClick={() => languageMutation.mutate(lang)}
                  disabled={active || languageMutation.isPending}
                  aria-pressed={active}
                  className={`text-sm font-medium px-4 py-2 rounded-lg border transition-colors ${
                    active
                      ? 'bg-brand-green text-white border-brand-green'
                      : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {t(lang === 'da' ? 'settings.language.danish' : 'settings.language.english')}
                </button>
              );
            })}
          </div>
          {languageError && <p className="text-xs text-red-500">{languageError}</p>}
        </div>

      </main>

      {cropSrc && (
        <AvatarCropper
          src={cropSrc}
          busy={avatarMutation.isPending}
          onCancel={() => setCropSrc(null)}
          onSave={(dataUrl) => avatarMutation.mutate(dataUrl)}
        />
      )}
    </div>
  );
}
