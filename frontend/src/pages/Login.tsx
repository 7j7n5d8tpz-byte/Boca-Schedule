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
      const role = await login(email, password);
      navigate(role === 'coach' || role === 'admin' ? '/coach' : '/dashboard');
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
    <div className="min-h-screen bg-gray-50 boca-page flex items-center justify-center">
      <div className="w-full max-w-md">
        {/* Brand header */}
        <div className="bg-brand-dark rounded-t-2xl px-8 pt-8 pb-6 relative overflow-hidden">
          {/* Stripe accent — mirrors the shirt stripe */}
          <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-brand-green" />
          <div className="absolute left-1.5 top-0 bottom-0 w-0.5 bg-brand-red" />
          <div className="flex items-center gap-4">
            <img src="/boca-logo.png" alt="Boca" className="w-14 h-14 shrink-0 drop-shadow-md" />
            <div>
              <h1 className="text-xl font-bold text-white leading-tight">Boca Schedule</h1>
              <p className="text-white/50 text-xs">Team management</p>
            </div>
          </div>
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
