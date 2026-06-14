import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client';

export default function ResetPassword() {
  const navigate = useNavigate();
  const [accessToken, setAccessToken] = useState('');
  const [tokenError, setTokenError]   = useState(false);
  const [password, setPassword]       = useState('');
  const [confirm, setConfirm]         = useState('');
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState('');
  const [done, setDone]               = useState(false);

  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.substring(1));
    const token = hash.get('access_token');
    const type  = hash.get('type');
    if (token && type === 'recovery') {
      setAccessToken(token);
    } else {
      setTokenError(true);
    }
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setLoading(true);
    try {
      await api.post('/auth/reset-password', { accessToken, newPassword: password });
      setDone(true);
      setTimeout(() => navigate('/login'), 2500);
    } catch (err: any) {
      setError(err.response?.data?.error?.message ?? 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-dvh bg-gray-50 boca-page flex items-center justify-center">
      <div className="w-full max-w-md">
        <div className="bg-brand-dark rounded-t-2xl px-8 pt-12 pb-10 relative overflow-hidden flex flex-col items-center">
          <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 flex" aria-hidden>
            <div className="w-4 bg-brand-green" />
            <div className="w-4 bg-brand-red" />
            <div className="w-4 bg-brand-green" />
          </div>
          <img src="/boca-logo.png" alt="Boca Boldisch" className="relative w-28 h-28 drop-shadow-xl" />
          <h1 className="relative mt-4 font-display font-extrabold uppercase tracking-wide text-white text-2xl leading-none text-center">Boca Boldisch</h1>
          <p className="relative mt-1.5 text-white/50 text-xs tracking-wide">Set new password</p>
        </div>

        <div className="bg-white rounded-b-2xl shadow-md px-8 py-6">
          {tokenError && (
            <div className="space-y-4">
              <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
                This reset link is invalid or has expired.{' '}
                <Link to="/forgot-password" className="underline font-medium">Request a new one.</Link>
              </div>
            </div>
          )}

          {done && (
            <div className="bg-green-50 border border-green-200 text-green-700 rounded-lg px-4 py-3 text-sm">
              Password updated. Redirecting to sign in…
            </div>
          )}

          {!tokenError && !done && (
            <>
              <p className="text-gray-500 text-sm mb-5">Choose a new password for your account.</p>

              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 mb-4 text-sm">
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">New password</label>
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green"
                    placeholder="••••••••"
                  />
                  <p className="text-xs text-gray-400 mt-1">Min 8 characters, one uppercase, one number, one special character (!@#$%^&*)</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Confirm password</label>
                  <input
                    type="password"
                    required
                    value={confirm}
                    onChange={e => setConfirm(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green"
                    placeholder="••••••••"
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-brand-green hover:bg-brand-green-700 disabled:opacity-50 text-white font-medium py-2.5 rounded-lg text-sm transition-colors"
                >
                  {loading ? 'Saving…' : 'Set new password'}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
