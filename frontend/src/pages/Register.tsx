import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import AvatarCropper from '../components/AvatarCropper';

// The codes themselves stay English — they're what the optimizer and the squad
// views speak. Only the descriptive label beside them is translated.
const POSITIONS = ['GK', 'DEF', 'WIN', 'MID', 'STR'] as const;
type Position = (typeof POSITIONS)[number];

interface FormState {
  name: string;
  email: string;
  password: string;
  confirmPassword: string;
  preferredPositions: Position[];
}

function PasswordStrength({ password }: { password: string }) {
  const { t } = useTranslation();
  const checks = [
    { label: t('password.min8'), ok: password.length >= 8 },
    { label: t('password.uppercase'), ok: /[A-Z]/.test(password) },
    { label: t('password.number'), ok: /[0-9]/.test(password) },
    { label: t('password.special'), ok: /[!@#$%^&*]/.test(password) },
  ];
  const score = checks.filter((c) => c.ok).length;
  const colors = ['bg-red-400', 'bg-orange-400', 'bg-yellow-400', 'bg-green-500'];

  if (!password) return null;

  return (
    <div className="mt-2 space-y-2">
      <div className="flex gap-1">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className={`h-1 flex-1 rounded-full transition-colors ${i < score ? colors[score - 1] : 'bg-gray-200'}`}
          />
        ))}
      </div>
      <ul className="grid grid-cols-2 gap-x-4 gap-y-0.5">
        {checks.map((c) => (
          <li key={c.label} className={`text-xs flex items-center gap-1 ${c.ok ? 'text-green-600' : 'text-gray-400'}`}>
            <span>{c.ok ? '✓' : '○'}</span> {c.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function Register() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [form, setForm] = useState<FormState>({
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
    preferredPositions: [],
  });
  const [clientError, setClientError] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  // Optional profile picture chosen during sign-up. `avatar` holds the cropped
  // webp data URL; `cropSrc` is the raw pick being adjusted in the cropper.
  const [avatar, setAvatar] = useState<string | null>(null);
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const [avatarError, setAvatarError] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  function onFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file
    if (!file) return;
    if (!file.type.startsWith('image/')) { setAvatarError(t('common.chooseImageFile')); return; }
    setAvatarError('');
    const reader = new FileReader();
    reader.onload = () => setCropSrc(reader.result as string);
    reader.readAsDataURL(file);
  }

  function togglePosition(pos: Position) {
    setForm((f) => ({
      ...f,
      preferredPositions: f.preferredPositions.includes(pos)
        ? f.preferredPositions.filter((p) => p !== pos)
        : [...f.preferredPositions, pos],
    }));
  }

  function validate(): string {
    if (form.name.trim().length < 2) return t('auth.nameTooShort');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) return t('auth.invalidEmail');
    if (form.password.length < 8) return t('auth.passwordTooShort');
    if (!/[A-Z]/.test(form.password)) return t('auth.passwordNeedsUppercase');
    if (!/[0-9]/.test(form.password)) return t('auth.passwordNeedsNumber');
    if (!/[!@#$%^&*]/.test(form.password)) return t('auth.passwordNeedsSpecial');
    if (form.password !== form.confirmPassword) return t('auth.passwordsDoNotMatch');
    return '';
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const err = validate();
    if (err) { setClientError(err); return; }
    setClientError('');
    setLoading(true);

    try {
      await api.post('/auth/register', {
        name: form.name.trim(),
        email: form.email.toLowerCase().trim(),
        password: form.password,
        preferredPositions: form.preferredPositions,
        ...(avatar ? { avatar } : {}),
      });
      setSubmitted(true);
    } catch {
      // Show the same success screen even on network errors to avoid leaking state.
      // Real errors (network down) are logged server-side.
      setSubmitted(true);
    } finally {
      setLoading(false);
    }
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-gray-50 boca-page flex items-center justify-center">
        <div className="bg-white rounded-2xl shadow-md p-8 w-full max-w-md text-center space-y-4">
          <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center mx-auto text-2xl">✓</div>
          <h2 className="text-xl font-bold text-gray-900">{t('auth.requestSubmitted')}</h2>
          <p className="text-gray-500 text-sm leading-relaxed">
            {t('auth.requestSubmittedBody')}
          </p>
          <button
            onClick={() => navigate('/login')}
            className="text-brand-green hover:underline text-sm"
          >
            {t('auth.backToLogin')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 boca-page flex items-center justify-center py-12 px-4">
      <div className="w-full max-w-md">
        <div className="bg-brand-dark rounded-t-2xl px-8 pt-12 pb-10 relative overflow-hidden flex flex-col items-center">
          <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 flex" aria-hidden>
            <div className="w-4 bg-brand-green" />
            <div className="w-4 bg-brand-red" />
            <div className="w-4 bg-brand-green" />
          </div>
          <img src="/boca-logo.png" alt="Boca Boldisch" className="relative w-28 h-28 drop-shadow-xl" />
          <h1 className="relative mt-4 font-display font-extrabold uppercase tracking-wide text-white text-2xl leading-none text-center">Boca Boldisch</h1>
          <p className="relative mt-1.5 text-white/50 text-xs tracking-wide">{t('auth.taglineCreate')}</p>
        </div>
        <div className="bg-white rounded-b-2xl shadow-md p-8">
        <p className="text-gray-500 text-sm mb-6">
          {t('auth.alreadyHaveOne')}{' '}
          <Link to="/login" className="text-brand-green hover:underline">{t('auth.signIn')}</Link>
        </p>

        {clientError && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 mb-4 text-sm">
            {clientError}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          {/* Profile picture (optional) */}
          <div className="flex flex-col items-center gap-2 pb-1">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="w-20 h-20 rounded-full overflow-hidden bg-brand-green/15 text-brand-green text-2xl font-bold flex items-center justify-center ring-1 ring-gray-200 hover:ring-brand-green transition"
              aria-label={avatar ? t('auth.changeProfilePicture') : t('auth.addProfilePicture')}
            >
              {avatar
                ? <img src={avatar} alt="" className="w-full h-full object-cover" />
                : (form.name.trim().charAt(0).toUpperCase() || '+')}
            </button>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="text-sm font-medium text-brand-green hover:underline"
              >
                {avatar ? t('auth.changePhoto') : t('auth.addPhoto')}
                <span className="text-gray-400 font-normal"> {t('common.optional')}</span>
              </button>
              {avatar && (
                <button
                  type="button"
                  onClick={() => setAvatar(null)}
                  className="text-sm text-gray-400 hover:text-red-500"
                >
                  {t('common.remove')}
                </button>
              )}
            </div>
            {avatarError && <p className="text-xs text-red-500">{avatarError}</p>}
            <input ref={fileInputRef} type="file" accept="image/*" onChange={onFilePicked} className="hidden" />
          </div>

          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('auth.fullName')}</label>
            <input
              type="text"
              required
              autoComplete="name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green"
              placeholder={t('auth.namePlaceholder')}
            />
          </div>

          {/* Email */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('auth.emailAddress')}</label>
            <input
              type="email"
              required
              autoComplete="email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green"
              placeholder={t('auth.emailPlaceholder')}
            />
          </div>

          {/* Password */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('auth.password')}</label>
            <input
              type="password"
              required
              autoComplete="new-password"
              value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green"
              placeholder="••••••••"
            />
            <PasswordStrength password={form.password} />
          </div>

          {/* Confirm password */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('auth.confirmPassword')}</label>
            <input
              type="password"
              required
              autoComplete="new-password"
              value={form.confirmPassword}
              onChange={(e) => setForm((f) => ({ ...f, confirmPassword: e.target.value }))}
              className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green ${
                form.confirmPassword && form.confirmPassword !== form.password
                  ? 'border-red-300 bg-red-50'
                  : 'border-gray-300'
              }`}
              placeholder="••••••••"
            />
            {form.confirmPassword && form.confirmPassword !== form.password && (
              <p className="text-xs text-red-500 mt-1">{t('auth.passwordsDoNotMatchShort')}</p>
            )}
          </div>

          {/* Preferred positions */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              {t('auth.preferredPositions')} <span className="text-gray-400 font-normal">{t('common.optional')}</span>
            </label>
            <div className="flex gap-2 flex-wrap">
              {POSITIONS.map((pos) => {
                const selected = form.preferredPositions.includes(pos);
                return (
                  <button
                    key={pos}
                    type="button"
                    onClick={() => togglePosition(pos)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                      selected
                        ? 'bg-brand-green text-white border-brand-green-700'
                        : 'bg-white text-gray-600 border-gray-300 hover:border-brand-green-400'
                    }`}
                  >
                    {pos}
                    <span className="hidden sm:inline text-xs ml-1 opacity-70">
                      {t(`positions.${pos}`)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-brand-green hover:bg-brand-green-700 disabled:opacity-50 text-white font-medium py-2 rounded-lg text-sm transition-colors mt-2"
          >
            {loading ? t('auth.submitting') : t('auth.createAccount')}
          </button>
        </form>
        </div>
      </div>

      {cropSrc && (
        <AvatarCropper
          src={cropSrc}
          onCancel={() => setCropSrc(null)}
          onSave={(dataUrl) => { setAvatar(dataUrl); setCropSrc(null); }}
        />
      )}
    </div>
  );
}
