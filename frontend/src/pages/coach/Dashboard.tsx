import AppNav from '../../components/AppNav';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import { formatLocation } from '../../components/LocationPicker';
import { meetingTime, mapsUrl } from '../../utils';
import { CardListSkeleton } from '../../components/Skeleton';

interface Match {
  matchId: string;
  matchDate: string;
  matchTime: string;
  location: string;
  opponent: string | null;
  matchType: string;
  status: string;
  currentSignups: number;
  minPlayers: number;
  maxPlayers: number;
  signupDeadlinePassed: boolean;
}

interface Announcement {
  announcementId: string;
  body: string;
  createdAt: string;
  author: string;
  match: { matchId: string; matchDate: string; opponent: string | null } | null;
}

const STATUS_STYLE: Record<string, string> = {
  draft:         'bg-gray-100 text-gray-600',
  signup_open:   'bg-green-100 text-green-700',
  signup_closed: 'bg-yellow-100 text-yellow-700',
  optimized:     'bg-blue-100 text-blue-700',
  published:     'bg-purple-100 text-purple-700',
  completed:     'bg-gray-100 text-gray-400',
};

const STATUS_LABEL: Record<string, string> = {
  draft:         'Draft',
  signup_open:   'Signup open',
  signup_closed: 'Signup closed',
  optimized:     'Optimized',
  published:     'Published',
  completed:     'Completed',
};

function MatchRow({ match }: { match: Match }) {
  const date = new Date(match.matchDate + 'T' + match.matchTime);
  const signupPct = Math.min(100, (match.currentSignups / match.maxPlayers) * 100);
  const low = match.currentSignups < match.minPlayers;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-start justify-between gap-4">
        {/* Date / location */}
        <div className="min-w-0">
          <p className="font-semibold text-gray-900">
            {date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
            {match.opponent && <span className="text-gray-500 font-normal"> · vs {match.opponent}</span>}
          </p>
          <p className="text-sm text-gray-700">
            {match.matchTime.slice(0, 5)} (meet at {meetingTime(match.matchTime)})
          </p>
          <p className="text-sm text-gray-500 mt-0.5 truncate">
            <a href={mapsUrl(match.location)} target="_blank" rel="noopener noreferrer" className="hover:text-brand-green hover:underline" title="Open in Maps">
              {formatLocation(match.location, match.matchType)}
            </a>
            <span className={`ml-2 text-xs font-medium px-1.5 py-0.5 rounded ${match.matchType === 'futsal' ? 'bg-orange-100 text-orange-700' : 'bg-gray-100 text-gray-500'}`}>
              {match.matchType}
            </span>
          </p>
        </div>

        {/* Status badge */}
        <span className={`shrink-0 text-xs font-medium px-2.5 py-1 rounded-full ${STATUS_STYLE[match.status] ?? 'bg-gray-100 text-gray-500'}`}>
          {STATUS_LABEL[match.status] ?? match.status}
        </span>
      </div>

      {/* Sign-up bar */}
      <div className="mt-4 space-y-1">
        <div className="flex justify-between text-xs text-gray-500">
          <span className={low ? 'text-red-500 font-medium' : ''}>
            {match.currentSignups} / {match.maxPlayers} signed up
            {low && <span> — need {match.minPlayers - match.currentSignups} more</span>}
          </span>
          <span>min {match.minPlayers}</span>
        </div>
        <div className="w-full bg-gray-100 rounded-full h-1.5">
          <div
            className={`h-1.5 rounded-full transition-all ${low ? 'bg-red-400' : 'bg-green-500'}`}
            style={{ width: `${signupPct}%` }}
          />
        </div>
      </div>

      {/* Actions */}
      <div className="mt-4 flex gap-2">
        <Link
          to={`/coach/matches/${match.matchId}`}
          className="text-sm text-brand-green hover:underline"
        >
          View signups
        </Link>
        {match.status === 'signup_closed' && (
          <span className="text-sm text-gray-400">· Ready to optimize</span>
        )}
      </div>
    </div>
  );
}

export default function CoachDashboard() {
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['matches', 'coach-all'],
    queryFn: () => api.get('/matches/upcoming?status=all').then(r => r.data.data),
  });

  const { data: pendingPerms } = useQuery<{ requestId: string; playerId: string; playerName: string; requestedAt: string }[]>({
    queryKey: ['result-permissions-pending'],
    queryFn: () => api.get('/result-permissions/pending').then(r => r.data.data),
    refetchInterval: 30_000,
  });

  const respondPerm = useMutation({
    mutationFn: ({ requestId, approve }: { requestId: string; approve: boolean }) =>
      api.put(`/result-permissions/${requestId}/respond`, { approve }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['result-permissions-pending'] }),
  });

  const [showRecordedResults, setShowRecordedResults] = useState(false);

  // ── Announcements ──
  const { data: announcements } = useQuery<Announcement[]>({
    queryKey: ['announcements'],
    queryFn: () => api.get('/announcements').then(r => r.data.data),
  });
  const [announceBody, setAnnounceBody] = useState('');
  const [announceMatchId, setAnnounceMatchId] = useState('');

  const postAnnouncement = useMutation({
    mutationFn: () => api.post('/announcements', { body: announceBody.trim(), matchId: announceMatchId || null }),
    onSuccess: () => {
      setAnnounceBody(''); setAnnounceMatchId('');
      qc.invalidateQueries({ queryKey: ['announcements'] });
    },
  });

  const deleteAnnouncement = useMutation({
    mutationFn: (id: string) => api.delete(`/announcements/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['announcements'] }),
  });

  const STATUS_ORDER: Record<string, number> = {
    signup_open:   0,
    signup_closed: 1,
    optimized:     2,
    published:     3,
  };

  const matches: Match[] = (data?.matches ?? []).slice().sort((a: any, b: any) => {
    const sd = (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99);
    if (sd !== 0) return sd;
    return a.matchDate < b.matchDate ? -1 : a.matchDate > b.matchDate ? 1 : 0;
  });
  const totalSignups = matches.reduce((s, m) => s + m.currentSignups, 0);
  const readyToOptimize = matches.filter(m => m.status === 'signup_closed' || m.status === 'optimized').length;
  const pendingResults   = matches.filter(m => m.status === 'published');
  const completedResults = matches.filter(m => m.status === 'completed');

  return (
    <div className="min-h-screen bg-gray-50 boca-page">
      {/* Nav */}
      <AppNav />

      <main className="max-w-2xl mx-auto px-4 py-8 space-y-8">

        {/* Permission requests */}
        {(pendingPerms ?? []).length > 0 && (
          <div className="bg-white rounded-xl border border-amber-200 p-5 space-y-3">
            <h2 className="font-semibold text-gray-900">
              Result entry requests
              <span className="ml-2 text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">{pendingPerms!.length}</span>
            </h2>
            {pendingPerms!.map(req => (
              <div key={req.requestId} className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-gray-900">{req.playerName}</p>
                  <p className="text-xs text-gray-400">Wants permission to record match results</p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => respondPerm.mutate({ requestId: req.requestId, approve: true })}
                    disabled={respondPerm.isPending}
                    className="text-xs bg-brand-green hover:bg-brand-green-700 disabled:opacity-50 text-white font-medium px-3 py-1.5 rounded-lg transition-colors"
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => respondPerm.mutate({ requestId: req.requestId, approve: false })}
                    disabled={respondPerm.isPending}
                    className="text-xs border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50 font-medium px-3 py-1.5 rounded-lg transition-colors"
                  >
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Announcements */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
          <h2 className="font-semibold text-gray-900">Announcements</h2>
          <p className="text-xs text-gray-400 -mt-1">Shown to all players on their dashboard. Tie one to a match to auto-hide it once that match has passed.</p>

          <textarea
            value={announceBody}
            onChange={e => setAnnounceBody(e.target.value)}
            placeholder="e.g. Bring white shirts on Saturday"
            rows={2}
            maxLength={500}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green resize-none"
          />
          <div className="flex gap-2">
            <select
              value={announceMatchId}
              onChange={e => setAnnounceMatchId(e.target.value)}
              className="flex-1 min-w-0 border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-green"
            >
              <option value="">No match (stays until removed)</option>
              {matches.filter(m => m.status !== 'completed').map(m => (
                <option key={m.matchId} value={m.matchId}>
                  {new Date(m.matchDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                  {m.opponent ? ` vs ${m.opponent}` : ''}
                </option>
              ))}
            </select>
            <button
              onClick={() => postAnnouncement.mutate()}
              disabled={!announceBody.trim() || postAnnouncement.isPending}
              className="shrink-0 bg-brand-green hover:bg-brand-green-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              {postAnnouncement.isPending ? 'Posting…' : 'Post'}
            </button>
          </div>

          {(announcements ?? []).length > 0 && (
            <div className="space-y-2 pt-1">
              {announcements!.map(a => (
                <div key={a.announcementId} className="bg-brand-green-50 border border-brand-green/30 rounded-lg px-3 py-2 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm text-gray-800 whitespace-pre-wrap">{a.body}</p>
                    {a.match && (
                      <p className="text-xs text-gray-400 mt-0.5">
                        for {new Date(a.match.matchDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}{a.match.opponent ? ` vs ${a.match.opponent}` : ''}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => deleteAnnouncement.mutate(a.announcementId)}
                    disabled={deleteAnnouncement.isPending}
                    className="shrink-0 text-xs text-red-400 hover:text-red-600 font-medium disabled:opacity-50"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Matches</h1>
            {!isLoading && (
              <p className="text-sm text-gray-500 mt-1">
                {matches.length} upcoming · {totalSignups} total sign-ups
                {readyToOptimize > 0 && (
                  <span className="ml-2 text-yellow-600 font-medium">
                    · {readyToOptimize} ready to optimize
                  </span>
                )}
              </p>
            )}
          </div>
          <div className="flex gap-2">
            {readyToOptimize >= 2 && (
              <Link
                to="/coach/optimize"
                className="border border-brand-green text-brand-green hover:bg-brand-green/5 text-sm font-medium px-4 py-2 rounded-lg transition-colors"
              >
                Optimize multiple
              </Link>
            )}
            <Link
              to="/coach/matches/new"
              className="bg-brand-green hover:bg-brand-green-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              + New match
            </Link>
          </div>
        </div>

        {/* Result entry shortcuts */}
        {(pendingResults.length > 0 || completedResults.length > 0) && (
          <div className="space-y-2">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Record results</h2>
            {pendingResults.length === 0 && (
              <p className="text-sm text-gray-400">All results recorded.</p>
            )}
            {pendingResults.map(m => {
              const d = new Date(m.matchDate + 'T' + m.matchTime);
              return (
                <Link
                  key={m.matchId}
                  to={`/matches/${m.matchId}/results`}
                  className="flex items-center justify-between bg-white rounded-xl border border-gray-200 px-5 py-3 hover:border-brand-green transition-colors"
                >
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      {d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })} · {m.matchTime.slice(0, 5)}
                      {m.opponent && <span className="text-gray-400 font-normal"> vs {m.opponent}</span>}
                    </p>
                    <p className="text-xs text-gray-400">{m.location}</p>
                  </div>
                  <span className="text-xs text-brand-green font-medium shrink-0">Enter result →</span>
                </Link>
              );
            })}
            {completedResults.length > 0 && (
              <>
                <button
                  onClick={() => setShowRecordedResults(v => !v)}
                  className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
                >
                  {showRecordedResults ? 'Hide recorded matches' : `+ ${completedResults.length} already recorded`}
                </button>
                {showRecordedResults && completedResults.map(m => {
                  const d = new Date(m.matchDate + 'T' + m.matchTime);
                  return (
                    <Link
                      key={m.matchId}
                      to={`/matches/${m.matchId}/results`}
                      className="flex items-center justify-between bg-white rounded-xl border border-gray-100 opacity-60 hover:opacity-90 px-5 py-3 transition-opacity"
                    >
                      <div>
                        <p className="text-sm font-medium text-gray-900">
                          {d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })} · {m.matchTime.slice(0, 5)}
                          {m.opponent && <span className="text-gray-400 font-normal"> vs {m.opponent}</span>}
                        </p>
                        <p className="text-xs text-gray-400">{m.location}</p>
                      </div>
                      <span className="text-xs text-gray-400 font-medium shrink-0">Edit result →</span>
                    </Link>
                  );
                })}
              </>
            )}
          </div>
        )}

        {/* Match list */}
        {isLoading && <CardListSkeleton />}
        {!isLoading && matches.length === 0 && (
          <p className="text-sm text-gray-400">No matches yet. Create one to get started.</p>
        )}
        <div className="space-y-4">
          {matches.filter(m => m.status !== 'completed').map(m => <MatchRow key={m.matchId} match={m} />)}
        </div>
      </main>
    </div>
  );
}
