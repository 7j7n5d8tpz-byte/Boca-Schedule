import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';

export default function ForgotPassword() {
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
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 boca-page flex items-center justify-center">
      <div className="w-full max-w-md">
        <div className="bg-brand-dark rounded-t-2xl px-8 pt-8 pb-6 relative overflow-hidden">
          <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-brand-green" />
          <div className="absolute left-1.5 top-0 bottom-0 w-0.5 bg-brand-red" />
          <div className="flex items-center gap-4">
            <img src="/boca-logo.png" alt="Boca" className="w-14 h-14 shrink-0 drop-shadow-md" />
            <div>
              <h1 className="text-xl font-bold text-white leading-tight">Boca Schedule</h1>
              <p className="text-white/50 text-xs">Password reset</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-b-2xl shadow-md px-8 py-6">
          {submitted ? (
            <div className="space-y-4">
              <div className="bg-green-50 border border-green-200 text-green-700 rounded-lg px-4 py-3 text-sm">
                If that email address is registered, a reset link has been sent. Check your inbox.
              </div>
              <Link to="/login" className="block text-center text-sm text-brand-green hover:underline font-medium">
                Back to sign in
              </Link>
            </div>
          ) : (
            <>
              <p className="text-gray-500 text-sm mb-5">
                Enter your email and we'll send you a link to reset your password.
              </p>

              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 mb-4 text-sm">
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green"
                    placeholder="you@example.com"
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-brand-green hover:bg-brand-green-700 disabled:opacity-50 text-white font-medium py-2.5 rounded-lg text-sm transition-colors"
                >
                  {loading ? 'Sending…' : 'Send reset link'}
                </button>
              </form>

              <p className="text-center text-sm text-gray-400 mt-4">
                <Link to="/login" className="text-brand-green hover:underline font-medium">Back to sign in</Link>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
