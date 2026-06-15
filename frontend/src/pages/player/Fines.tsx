import { useState } from 'react';
import AppNav from '../../components/AppNav';
import FinesView from './FinesView';
import FinesStats from './FinesStats';

export default function FinesPage() {
  const [view, setView] = useState<'overview' | 'stats'>('overview');

  return (
    <div className="min-h-screen bg-gray-50 boca-page">
      <AppNav />

      <main className="max-w-5xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-extrabold text-gray-900 mb-8">Team Fines</h1>

        {/* Sidebar + content layout (mirrors Team Statistics) */}
        <div className="flex flex-col sm:flex-row gap-6 items-stretch sm:items-start">

          {/* Sidebar — horizontal tab bar on mobile, sidebar on sm+ */}
          <nav className="w-full sm:w-44 shrink-0 bg-white rounded-xl border border-gray-200 p-2 flex sm:flex-col gap-1 sm:sticky sm:top-[calc(var(--app-nav-offset)+0.5rem)] transition-[top] duration-[var(--app-nav-dur)]">
            {([['overview', 'Overview'], ['stats', 'Stats']] as const).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setView(id)}
                className={`flex-1 sm:flex-none text-center sm:text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  view === id ? 'bg-brand-green text-white' : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                {label}
              </button>
            ))}
          </nav>

          {/* Main content */}
          <div className="flex-1 min-w-0">
            {view === 'overview' ? <FinesView /> : <FinesStats />}
          </div>
        </div>
      </main>
    </div>
  );
}
