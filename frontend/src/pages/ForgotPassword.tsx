import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';

export default function ForgotPassword() {
  const { t } = useTranslation();
  const [email, setEmail]       = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api.post('/auth/forgot-password', { email });
      setSubmitted(true);
    } catch {
      setError(t('auth.genericError'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 boca-page flex items-center justify-center">
      <div className="w-full max-w-md">
        <div className="bg-brand-dark rounded-t-2xl px-8 pt-12 pb-10 relative overflow-hidden flex flex-col items-center">
          <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 flex" aria-hidden>
            <div className="w-4 bg-brand-green" />
            <div className="w-4 bg-brand-red" />
            <div className="w-4 bg-brand-green" />
          </div>
          <img src="/boca-logo.png" alt="Boca Boldisch" className="relative w-28 h-28 drop-shadow-xl" />
          <h1 className="relative mt-4 font-display font-extrabold uppercase tracking-wide text-white text-2xl leading-none text-center">Boca Boldisch</h1>
          <p className="relative mt-1.5 text-white/50 text-xs tracking-wide">{t('auth.taglineReset')}</p>
        </div>

        <div className="bg-white rounded-b-2xl shadow-md px-8 py-6">
          {submitted ? (
            <div className="space-y-4">
              <div className="bg-green-50 border border-green-200 text-green-700 rounded-lg px-4 py-3 text-sm">
                {t('auth.resetSent')}
              </div>
              <Link to="/login" className="block text-center text-sm text-brand-green hover:underline font-medium">
                {t('auth.backToSignIn')}
              </Link>
            </div>
          ) : (
            <>
              <p className="text-gray-500 text-sm mb-5">
                {t('auth.forgotPrompt')}
              </p>

              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 mb-4 text-sm">
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">{t('auth.email')}</label>
                  <input
                    id="email"
                    type="email"
                    required
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green"
                    placeholder={t('auth.emailPlaceholder')}
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-brand-green hover:bg-brand-green-700 disabled:opacity-50 text-white font-medium py-2.5 rounded-lg text-sm transition-colors"
                >
                  {loading ? t('auth.sending') : t('auth.sendResetLink')}
                </button>
              </form>

              <p className="text-center text-sm text-gray-400 mt-4">
                <Link to="/login" className="text-brand-green hover:underline font-medium">{t('auth.backToSignIn')}</Link>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
