import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      // Everyone lands on the shared player dashboard; coaches/admins reach their
      // management views from the menu.
      await login(email, password);
      navigate('/dashboard');
    } catch (err: any) {
      const msg = err?.response?.data?.error?.message ?? '';
      if (msg.toLowerCase().includes('too many requests') || err?.response?.status === 429) {
        setError('Too many sign-in attempts. Please wait a few minutes and try again.');
      } else {
        setError('Invalid email or password.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-dvh bg-gray-50 boca-page flex items-center justify-center">
      <div className="w-full max-w-md">
        {/* Brand hero — the shirt's kit stripe, crest centred on it. */}
        <div className="bg-brand-dark rounded-t-2xl px-8 pt-12 pb-10 relative overflow-hidden flex flex-col items-center">
          {/* Bold green-red-green stripe running the full height, like the jersey. */}
          <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 flex" aria-hidden>
            <div className="w-4 bg-brand-green" />
            <div className="w-4 bg-brand-red" />
            <div className="w-4 bg-brand-green" />
          </div>
          {/* Crest sits on the stripe; wordmark below. */}
          <img src="/boca-logo.png" alt="Boca Boldisch" className="relative w-28 h-28 drop-shadow-xl" />
          <h1 className="relative mt-4 font-display font-extrabold uppercase tracking-wide text-white text-2xl leading-none text-center">Boca Boldisch</h1>
          <p className="relative mt-1.5 text-white/50 text-xs tracking-wide">Team management</p>
        </div>

        {/* Form card */}
        <div className="bg-white rounded-b-2xl shadow-md px-8 py-6">
          <p className="text-gray-500 text-sm mb-5">
            Sign in to your account.{' '}
            <Link to="/register" className="text-brand-green hover:underline font-medium">Create one</Link>
          </p>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 mb-4 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green"
                placeholder="you@example.com"
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label htmlFor="password" className="block text-sm font-medium text-gray-700">Password</label>
                <Link to="/forgot-password" className="text-xs text-brand-green hover:underline">Forgot password?</Link>
              </div>
              <input
                id="password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green"
                placeholder="••••••••"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-brand-green hover:bg-brand-green-700 disabled:opacity-50 text-white font-medium py-2.5 rounded-lg text-sm transition-colors"
            >
              {loading ? 'Signing in...' : 'Sign in'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
