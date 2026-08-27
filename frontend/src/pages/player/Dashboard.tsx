import AppNav from '../../components/AppNav';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useDateFormat } from '../../i18n/format';
import { DASHBOARD_ORIGIN } from '../../hubOrigin';
import { formatLocation } from '../../components/LocationPicker';
import { meetingTime, mapsUrl, buildMatchIcs, downloadIcs } from '../../utils';
import { CardListSkeleton } from '../../components/Skeleton';
import Icon from '../../components/Icon';
import CountUp from '../../components/CountUp';
import Crest, { tierRank } from '../../components/Crest';
import CrestUnlock from '../../components/CrestUnlock';
import { useCatalog, type PlayerAchievements } from '../../api/achievements';

interface Match {
  matchId: string;
  matchDate: string;
  matchTime: string;
  location: string;
  opponent: string | null;
  matchType: string;
  status: string;
  signupCloseDate: string;
  minPlayers: number;
  maxPlayers: number;
  currentSignups: number;
  userSignedUp: boolean;
  signupId: string | null;
  signupDeadlinePassed: boolean;
  lateSignupOpen: boolean;
  lateSignupSpotsLeft: number | null;
  signupIsLate: boolean;
  isSelected: boolean;
  openSpot: boolean;
  myClaim: { claimId: string; status: string } | null;
}

interface Player {
  userId: string;
  name: string;
  preferredPositions: string[];
}

interface Announcement {
  announcementId: string;
  body: string;
  createdAt: string;
  author: string;
  match: { matchId: string; matchDate: string; opponent: string | null } | null;
}

const POS_COLOR: Record<string, string> = {
  GK:  'bg-yellow-100 text-yellow-700',
  DEF: 'bg-blue-100 text-blue-700',
  WIN: 'bg-green-100 text-green-700',
  MID: 'bg-purple-100 text-purple-700',
  STR: 'bg-red-100 text-red-700',
};

// ─── Match card ───────────────────────────────────────────────────────────────

function CantAttendDialog({
  match,
  onClose,
}: {
  match: Match;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { t } = useTranslation();
  const { formatDate } = useDateFormat();
  const [releaseError, setReleaseError] = useState('');

  const releaseMutation = useMutation({
    mutationFn: () => api.post(`/matches/${match.matchId}/release`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['matches'] }); onClose(); },
    onError: (err: any) => setReleaseError(err.response?.data?.error?.message ?? t('match.releaseFailed')),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">{t('match.cantAttendTitle')}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">✕</button>
        </div>
        <p className="text-sm text-gray-500">
          {formatDate(match.matchDate, 'long')}
          {' — '}{match.matchTime.slice(0, 5)}
        </p>

        <p className="text-sm text-gray-500">
          {t('match.cantAttendBody')}
        </p>

        <div className="space-y-2">
          <button
            onClick={() => { setReleaseError(''); releaseMutation.mutate(); }}
            disabled={releaseMutation.isPending}
            className="w-full text-left px-4 py-3 rounded-xl border border-red-200 hover:bg-red-50 transition-colors disabled:opacity-50"
          >
            <p className="font-medium text-red-600 text-sm">{releaseMutation.isPending ? t('match.releasing') : t('match.releaseSpot')}</p>
            <p className="text-xs text-gray-400 mt-0.5">{t('match.releaseNote')}</p>
          </button>
        </div>

        {releaseError && <p className="text-sm text-red-500">{releaseError}</p>}
      </div>
    </div>
  );
}

function MatchCard({ match }: { match: Match }) {
  const qc = useQueryClient();
  const { t } = useTranslation();
  const { formatDate } = useDateFormat();
  const [showCantAttend, setShowCantAttend] = useState(false);
  const [showSquad, setShowSquad] = useState(false);
  const [showSignups, setShowSignups] = useState(false);
  const [claimError, setClaimError] = useState('');

  const { data: squad } = useQuery<{ selected: Player[]; guests: { name: string; position: string | null }[]; count: number }>({
    queryKey: ['squad', match.matchId],
    queryFn: () => api.get(`/matches/${match.matchId}/squad`).then(r => r.data.data),
    enabled: showSquad && match.status === 'published',
  });

  const { data: signupList } = useQuery<{ players: Player[]; count: number }>({
    queryKey: ['signup-list', match.matchId],
    queryFn: () => api.get(`/matches/${match.matchId}/signup-list`).then(r => r.data.data),
    enabled: showSignups,
  });

  const signupMutation = useMutation({
    mutationFn: () => api.post('/signups', { matchId: match.matchId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['matches'] });
      qc.invalidateQueries({ queryKey: ['signup-list', match.matchId] });
    },
  });

  const withdrawMutation = useMutation({
    mutationFn: () => api.delete(`/signups/${match.signupId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['matches'] });
      qc.invalidateQueries({ queryKey: ['signup-list', match.matchId] });
    },
  });

  const claimMutation = useMutation({
    mutationFn: () => api.post(`/matches/${match.matchId}/claims`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['matches'] }),
    onError: (err: any) => setClaimError(err.response?.data?.error?.message ?? t('match.claimFailed')),
  });

  const cancelClaimMutation = useMutation({
    mutationFn: () => api.delete(`/claims/${match.myClaim!.claimId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['matches'] }),
  });

  function addToCalendar() {
    const ics = buildMatchIcs({
      matchId: match.matchId, matchDate: match.matchDate, matchTime: match.matchTime,
      location: match.location, opponent: match.opponent,
    });
    // Filename only — keep it ASCII-stable and locale-independent.
    const dateLabel = new Date(match.matchDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }).replace(' ', '-');
    downloadIcs(`boca-${dateLabel}.ics`, ics);
  }

  const deadline = new Date(match.signupCloseDate);
  const canSignUp =
    !match.userSignedUp &&
    ((match.status === 'signup_open' && !match.signupDeadlinePassed) || match.lateSignupOpen);
  // Withdrawal normally stops at the deadline. A sign-up made *after* it stays
  // withdrawable pre-publish, so a mistaken late sign-up isn't a trap.
  const canWithdraw =
    match.userSignedUp &&
    (!match.signupDeadlinePassed || match.signupIsLate) &&
    match.status !== 'published' &&
    match.status !== 'completed';

  return (
    <>
      {showCantAttend && (
        <CantAttendDialog
          match={match}
          onClose={() => setShowCantAttend(false)}
        />
      )}

      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
        <div className="flex items-start justify-between">
          <div>
            <p className="font-semibold text-gray-900">
              {formatDate(match.matchDate, 'long')}
              {match.opponent && <span className="text-gray-500 font-normal"> · vs {match.opponent}</span>}
            </p>
            <p className="text-sm text-gray-700">
              {t('match.timeAndMeet', { time: match.matchTime.slice(0, 5), meet: meetingTime(match.matchTime) })}
            </p>
            <p className="text-sm text-gray-500">
              <a
                href={mapsUrl(match.location)}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-brand-green hover:underline"
                title={t('match.openInMaps')}
              >
                {formatLocation(match.location, match.matchType)}
              </a>
              <span className={`ml-2 text-xs font-medium px-1.5 py-0.5 rounded ${match.matchType === 'futsal' ? 'bg-orange-100 text-orange-700' : 'bg-gray-100 text-gray-500'}`}>
                {t(`matchTypes.${match.matchType}`, { defaultValue: match.matchType })}
              </span>
            </p>
          </div>
          <div className="flex flex-col items-end gap-1">
            {match.userSignedUp && match.status === 'published' && match.isSelected && (
              <span className="bg-green-100 text-green-700 text-xs font-medium px-2.5 py-1 rounded-full">{t('match.selected')}</span>
            )}
            {match.userSignedUp && match.status === 'published' && !match.isSelected && (
              <span className="bg-gray-100 text-gray-500 text-xs font-medium px-2.5 py-1 rounded-full">{t('match.notSelected')}</span>
            )}
            {match.userSignedUp && match.status !== 'published' && match.status !== 'completed' && (
              <span className="bg-blue-100 text-blue-700 text-xs font-medium px-2.5 py-1 rounded-full">{t('match.signedUp')}</span>
            )}
          </div>
        </div>

        {/* No sign-up cap — show the count only, never a "x of max" ratio, so
            nobody reads sign-up as first-come, first-served. */}
        <div className="flex gap-4 text-sm text-gray-600">
          {match.currentSignups > 0 ? (
            <button
              onClick={() => setShowSignups(v => !v)}
              className="hover:text-brand-green transition-colors inline-flex items-center gap-1"
            >
              {t('match.signupCount', { count: match.currentSignups })}
              <Icon name="chevronDown" className={`w-3.5 h-3.5 transition-transform ${showSignups ? 'rotate-180' : ''}`} />
            </button>
          ) : (
            <span>{t('match.noneSignedUp')}</span>
          )}
          <span>{t('match.deadline', { date: formatDate(deadline, 'dayMonthTime') })}</span>
        </div>

        {showSignups && signupList && (
          <div className="space-y-1.5">
            {signupList.players.map(p => (
              <div key={p.userId} className="flex items-center gap-2 text-sm">
                <span className="text-gray-700 flex-1 truncate">{p.name}</span>
                <span className="flex gap-1 shrink-0">
                  {p.preferredPositions.map(pos => (
                    <span key={pos} className={`text-xs font-medium px-1.5 py-0.5 rounded ${POS_COLOR[pos] ?? 'bg-gray-100 text-gray-500'}`}>{pos}</span>
                  ))}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Deadline passed but the match is short of players — sign-ups reopened
            until enough people are in to field it. */}
        {match.lateSignupOpen && !match.userSignedUp && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            <p className="text-xs text-amber-800 flex items-start gap-1.5">
              <Icon name="megaphone" className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <span>
                Deadline passed but we're short of players — sign-ups are open again
                {match.lateSignupSpotsLeft !== null && (
                  <> for {match.lateSignupSpotsLeft} more {match.lateSignupSpotsLeft === 1 ? 'player' : 'players'}</>
                )}.
              </span>
            </p>
          </div>
        )}

        {/* Open spot available — claimable by players not in the squad */}
        {match.status === 'published' && !match.isSelected && match.openSpot && !match.myClaim && (
          <div className="bg-brand-green-50 border border-brand-green/30 rounded-lg px-3 py-2 flex items-center justify-between gap-3">
            <p className="text-xs text-gray-700 flex items-center gap-1.5">
              <Icon name="tag" className="w-4 h-4 text-brand-green shrink-0" /> {t('match.openSpot')}
            </p>
            <button
              onClick={() => { setClaimError(''); claimMutation.mutate(); }}
              disabled={claimMutation.isPending}
              className="text-xs bg-brand-green hover:bg-brand-green-700 text-white font-medium px-3 py-1.5 rounded-lg shrink-0 disabled:opacity-50 transition-colors"
            >
              {claimMutation.isPending ? t('match.claiming') : t('match.claimSpot')}
            </button>
          </div>
        )}
        {claimError && <p className="text-xs text-red-500">{claimError}</p>}

        {/* Pending claim notice */}
        {match.myClaim && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-center justify-between gap-3">
            <p className="text-xs text-amber-700">
              {t('match.claimPending')}
            </p>
            <button
              onClick={() => cancelClaimMutation.mutate()}
              disabled={cancelClaimMutation.isPending}
              className="text-xs text-amber-600 hover:text-amber-800 font-medium shrink-0 disabled:opacity-50"
            >
              {t('common.cancel')}
            </button>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 pt-1">
          {canSignUp && (
            <button
              onClick={() => signupMutation.mutate()}
              disabled={signupMutation.isPending}
              className="flex-1 bg-brand-green hover:bg-brand-green-700 disabled:opacity-50 text-white text-sm font-medium py-2 rounded-lg transition-colors"
            >
              {signupMutation.isPending ? t('match.signingUp') : match.lateSignupOpen ? t('match.signUpLate') : t('match.signUp')}
            </button>
          )}

          {canWithdraw && (
            <button
              onClick={() => withdrawMutation.mutate()}
              disabled={withdrawMutation.isPending}
              className="flex-1 border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50 text-sm font-medium py-2 rounded-lg transition-colors"
            >
              {withdrawMutation.isPending ? t('match.withdrawing') : t('match.withdraw')}
            </button>
          )}

          {match.isSelected && match.status === 'published' && (
            <button
              onClick={() => setShowCantAttend(true)}
              className="flex-1 border border-orange-300 text-orange-600 hover:bg-orange-50 text-sm font-medium py-2 rounded-lg transition-colors"
            >
              {t('match.cantAttend')}
            </button>
          )}

          {match.signupDeadlinePassed && !match.lateSignupOpen && !match.userSignedUp && match.status !== 'published' && (
            <p className="text-xs text-gray-400 text-center w-full py-1">{t('match.signupClosed')}</p>
          )}
        </div>

        {/* Footer: calendar + squad */}
        {(match.userSignedUp || match.isSelected || match.status === 'published') && (
          <div className="pt-1 border-t border-gray-100 flex items-center gap-4 mt-2">
            {(match.userSignedUp || match.isSelected) && (
              <button
                onClick={addToCalendar}
                className="text-xs text-gray-400 hover:text-brand-green transition-colors inline-flex items-center gap-1.5"
              >
                <Icon name="calendar" className="w-3.5 h-3.5" /> {t('match.addToCalendar')}
              </button>
            )}
            {match.status === 'published' && (
              <button
                onClick={() => setShowSquad(v => !v)}
                className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
              >
                {showSquad
                  ? t('match.hideSquad')
                  : squad ? t('match.viewSquadCount', { count: squad.count }) : t('match.viewSquad')}
              </button>
            )}
          </div>
        )}

        {/* Confirmed squad (published matches) */}
        {match.status === 'published' && showSquad && (
          <div>
            {squad && (
              <div className="mt-2 space-y-1.5">
                {squad.selected.map(p => (
                  <div key={p.userId} className="flex items-center gap-2 text-sm">
                    <span className="text-gray-700 flex-1 truncate">{p.name}</span>
                    <span className="flex gap-1 shrink-0">
                      {p.preferredPositions.map(pos => (
                        <span key={pos} className={`text-xs font-medium px-1.5 py-0.5 rounded ${POS_COLOR[pos] ?? 'bg-gray-100 text-gray-500'}`}>{pos}</span>
                      ))}
                    </span>
                  </div>
                ))}
                {squad.guests.map((g, i) => (
                  <div key={`g${i}`} className="flex items-center gap-2 text-sm">
                    <span className="text-gray-700 flex-1 truncate">{g.name}</span>
                    <span className="flex gap-1 shrink-0">
                      <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">{t('match.guest')}{g.position ? ` · ${g.position}` : ''}</span>
                    </span>
                  </div>
                ))}
                {squad.count === 0 && <p className="text-xs text-gray-400">{t('match.noPlayersSelected')}</p>}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}

// ─── Record results section ───────────────────────────────────────────────────

function ResultMatchesList({
  pending,
  recorded,
}: {
  pending: { matchId: string; matchDate: string; matchTime: string; location: string; opponent: string | null }[];
  recorded: { matchId: string; matchDate: string; matchTime: string; location: string; opponent: string | null }[];
}) {
  const { t } = useTranslation();
  const { formatDate } = useDateFormat();
  const [showRecorded, setShowRecorded] = useState(false);

  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold text-gray-900">{t('dashboard.resultsTitle')}</h2>
      {pending.length === 0 && (
        <p className="text-sm text-gray-400">{t('dashboard.resultsAllRecorded')}</p>
      )}
      {pending.map(m => (
        <Link
          key={m.matchId}
          to={`/matches/${m.matchId}/results`}
          className="flex items-center justify-between bg-white rounded-xl border border-gray-200 hover:border-brand-green px-5 py-3 transition-colors"
        >
          <div>
            <p className="text-sm font-medium text-gray-900">
              {formatDate(m.matchDate, 'weekdayDayMonth')}
              {' · '}{m.matchTime.slice(0, 5)}
              {m.opponent && <span className="text-gray-400 font-normal"> vs {m.opponent}</span>}
            </p>
            <p className="text-xs text-gray-400">{m.location}</p>
          </div>
          <span className="text-xs font-medium text-brand-green shrink-0">{t('dashboard.enterResult')}</span>
        </Link>
      ))}
      {recorded.length > 0 && (
        <>
          <button
            onClick={() => setShowRecorded(v => !v)}
            className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
          >
            {showRecorded ? t('dashboard.hideRecorded') : t('dashboard.alreadyRecorded', { count: recorded.length })}
          </button>
          {showRecorded && recorded.map(m => (
            <Link
              key={m.matchId}
              to={`/matches/${m.matchId}/results`}
              className="flex items-center justify-between bg-white rounded-xl border border-gray-100 opacity-60 hover:opacity-90 px-5 py-3 transition-opacity"
            >
              <div>
                <p className="text-sm font-medium text-gray-900">
                  {formatDate(m.matchDate, 'weekdayDayMonth')}
                  {' · '}{m.matchTime.slice(0, 5)}
                  {m.opponent && <span className="text-gray-400 font-normal"> vs {m.opponent}</span>}
                </p>
                <p className="text-xs text-gray-400">{m.location}</p>
              </div>
              <span className="text-xs font-medium text-gray-400 shrink-0">{t('dashboard.editResult')}</span>
            </Link>
          ))}
        </>
      )}
    </div>
  );
}

// ─── Main dashboard ───────────────────────────────────────────────────────────

export default function PlayerDashboard() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const { formatDate } = useDateFormat();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['matches'],
    queryFn: () => api.get('/matches/upcoming').then(r => r.data.data),
  });

  const { data: announcements } = useQuery<Announcement[]>({
    queryKey: ['announcements'],
    queryFn: () => api.get('/announcements').then(r => r.data.data),
  });

  const { data: statsData } = useQuery({
    queryKey: ['stats', user?.userId],
    queryFn: () => api.get(`/players/${user!.userId}/statistics`).then(r => r.data.data),
    enabled: !!user,
  });

  const { data: myPermission } = useQuery({
    queryKey: ['my-permission'],
    queryFn: () => api.get('/result-permissions/my').then(r => r.data.data),
    enabled: !!user,
  });

  const { data: finesSummary } = useQuery<{ totals: { outstandingDkk: number; claimedDkk: number; paidDkk: number } }>({
    queryKey: ['fines-summary'],
    queryFn: () => api.get('/fines/my').then(r => r.data.data),
    enabled: !!user,
  });

  const { data: achievements } = useQuery<PlayerAchievements>({
    queryKey: ['achievements', user?.userId],
    queryFn: () => api.get(`/players/${user!.userId}/achievements`).then(r => r.data.data),
    enabled: !!user,
  });
  const { data: achCatalog } = useCatalog(); // also warms the cache for the unlock modal
  const glyphFor = (code: string) =>
    achCatalog?.individual.find(c => c.code === code)?.glyph ?? 'medal';

  const isCoachOrAdmin = user?.role === 'coach' || user?.role === 'admin';
  const canEnterResults = isCoachOrAdmin || myPermission?.canEnterResults;

  const { data: resultMatches } = useQuery<{ matchId: string; matchDate: string; matchTime: string; location: string; status: string; matchType: string; opponent: string | null; hasResult: boolean }[]>({
    queryKey: ['result-matches'],
    queryFn: () => api.get('/matches/upcoming?status=published,completed').then(r => r.data.data.matches ?? []),
    enabled: !!canEnterResults,
  });

  const requestPermMutation = useMutation({
    mutationFn: () => api.post('/result-permissions/request'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['my-permission'] }),
  });

  const stats = statsData?.seasonStats;

  return (
    <div className="min-h-screen bg-gray-50 boca-page">
      <AppNav />
      {user && achievements && <CrestUnlock userId={user.userId} earned={achievements.earned} />}

      <main className="max-w-2xl mx-auto px-4 py-8 space-y-8">
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900">{t('dashboard.welcome', { name: user?.name?.split(' ')[0] })}</h1>
          <p className="text-gray-500 text-sm mt-1">{t('dashboard.subtitle')}</p>
        </div>

        {/* Announcements */}
        {(announcements ?? []).length > 0 && (
          <div className="space-y-2">
            {announcements!.map(a => (
              <div key={a.announcementId} className="bg-brand-green-50 border border-brand-green/30 rounded-xl px-4 py-3">
                <p className="text-sm text-gray-800 whitespace-pre-wrap flex gap-1.5"><Icon name="megaphone" className="w-4 h-4 text-brand-green shrink-0 mt-0.5" /> <span>{a.body}</span></p>
                <p className="text-xs text-gray-400 mt-1">
                  {a.author}
                  {a.match && ` · ${t('dashboard.announcementFor', { date: formatDate(a.match.matchDate, 'dayMonth') })}${a.match.opponent ? ` vs ${a.match.opponent}` : ''}`}
                </p>
              </div>
            ))}
          </div>
        )}

        {/* Stats */}
        {stats && (() => {
          const played   = stats.total_played  ?? 0;
          const teamGames = stats.total_team_games ?? 0;
          const signups  = stats.total_signups ?? 0;
          const goals    = stats.total_goals     ?? 0;
          const assists  = stats.total_assists   ?? 0;
          const sheets   = stats.total_clean_sheets ?? 0;
          const attend   = stats.attendance_rate ?? 0;
          const season   = stats.season_year;

          return (
            <div className="space-y-4">
              <div className="flex items-baseline justify-between">
                <h2 className="text-sm font-semibold text-gray-700">
                  {t('dashboard.yourSeason')}{season ? <span className="font-normal text-gray-400"> · {season}</span> : null}
                </h2>
                <Link
                  to={`/players/${user?.userId}`}
                  state={DASHBOARD_ORIGIN}
                  className="text-xs font-medium text-brand-green hover:text-brand-green-700 transition-colors"
                >
                  {t('dashboard.fullProfile')}
                </Link>
              </div>
              {/* The whole stat block opens your player hub — the one place with
                  the full picture (stats, crests, streaks, match history). */}
              <Link
                to={`/players/${user?.userId}`}
                state={DASHBOARD_ORIGIN}
                className="grid grid-cols-3 gap-3 group"
              >
                {[
                  { key: 'played',      value: played, suffix: ` / ${teamGames}` },
                  { key: 'goals',       value: goals },
                  { key: 'assists',     value: assists },
                  { key: 'signedUp',    value: signups },
                  { key: 'cleanSheets', value: sheets },
                  { key: 'attendance',  value: Math.round(attend), suffix: '%' },
                ].map(s => (
                  <div key={s.key} className="bg-white rounded-xl border border-gray-200 group-hover:border-brand-green p-4 text-center transition-colors">
                    <p className="text-2xl font-bold font-numeric text-gray-900"><CountUp value={s.value} />{s.suffix ?? ''}</p>
                    <p className="text-xs text-gray-500 mt-1">{t(`dashboard.stats.${s.key}`)}</p>
                  </div>
                ))}
              </Link>

              {/* Quick links */}
              <div className="space-y-3">
                <Link to="/statistics" className="bg-white rounded-xl border border-gray-200 hover:border-brand-green p-4 flex items-center justify-between gap-3 transition-colors group lift">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{t('dashboard.teamStatsTitle')}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{t('dashboard.teamStatsSub')}</p>
                  </div>
                  <span className="text-gray-300 group-hover:text-brand-green transition-colors text-lg">→</span>
                </Link>
                <Link to="/achievements" className="bg-white rounded-xl border border-gray-200 hover:border-brand-green p-4 flex items-center justify-between gap-3 transition-colors group lift">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900">{t('dashboard.achievementsTitle')}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {achievements && achievements.earned.length > 0
                        ? t('dashboard.achievementsEarned', { count: achievements.earned.length })
                        : t('dashboard.achievementsEmpty')}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {achievements && [...achievements.earned]
                      .sort((a, b) => tierRank(b.tier) - tierRank(a.tier))
                      .slice(0, 3)
                      .map(e => (
                        <Crest key={`${e.code}:${e.tier}`} glyph={glyphFor(e.code)} tier={e.tier} size={34} showRibbon={false} />
                      ))}
                    <span className="text-gray-300 group-hover:text-brand-green transition-colors text-lg">→</span>
                  </div>
                </Link>
              </div>
            </div>
          );
        })()}

        {/* Fines */}
        {finesSummary && (() => {
          const totals = finesSummary.totals;
          const due = totals.outstandingDkk;
          const awaiting = totals.claimedDkk;
          return (
            <Link
              to="/fines"
              className={`block rounded-xl border p-4 flex items-center justify-between gap-3 transition-colors group lift ${
                due > 0 ? 'bg-amber-50 border-amber-300 hover:border-amber-400' : 'bg-white border-gray-200 hover:border-brand-green'
              }`}
            >
              <div>
                <p className="text-sm font-semibold text-gray-900">{t('dashboard.finesTitle')}</p>
                <p className="text-xs mt-0.5 text-gray-500">
                  {due > 0
                    ? <span className="text-amber-700 font-medium">{t('dashboard.finesOutstanding', { amount: due.toLocaleString('da-DK') })}</span>
                    : awaiting > 0
                      ? <span className="text-blue-600">{t('dashboard.finesAwaiting', { amount: awaiting.toLocaleString('da-DK') })}</span>
                      : t('dashboard.finesSettled')}
                </p>
              </div>
              <span className="text-gray-300 group-hover:text-brand-green transition-colors text-lg">→</span>
            </Link>
          );
        })()}

        {/* Result entry permission */}
        {myPermission && !myPermission.canEnterResults && (
          <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-gray-900">{t('dashboard.permissionTitle')}</p>
              <p className="text-xs text-gray-400 mt-0.5">
                {myPermission.pendingRequest
                  ? t('dashboard.permissionPending')
                  : t('dashboard.permissionHelp')}
              </p>
            </div>
            {!myPermission.pendingRequest && (
              <button
                onClick={() => requestPermMutation.mutate()}
                disabled={requestPermMutation.isPending}
                className="shrink-0 text-xs bg-brand-green hover:bg-brand-green-700 disabled:opacity-50 text-white font-medium px-3 py-1.5 rounded-lg transition-colors"
              >
                {requestPermMutation.isPending ? t('dashboard.requesting') : t('dashboard.requestAccess')}
              </button>
            )}
            {myPermission.pendingRequest && (
              <span className="shrink-0 text-xs text-amber-600 font-medium">{t('dashboard.pending')}</span>
            )}
          </div>
        )}
        {canEnterResults && (() => {
          const pending  = (resultMatches ?? []).filter(m => !m.hasResult);
          const recorded = (resultMatches ?? []).filter(m =>  m.hasResult);
          if (!resultMatches || (!pending.length && !recorded.length)) return null;
          return (
            <ResultMatchesList pending={pending} recorded={recorded} />
          );
        })()}

        {/* Upcoming matches */}
        <div>
          <h2 className="text-lg font-semibold text-gray-900 mb-4">{t('dashboard.upcomingTitle')}</h2>
          {isLoading && <CardListSkeleton />}
          {!isLoading && !data?.matches?.length && (
            <p className="text-sm text-gray-400">{t('dashboard.upcomingEmpty')}</p>
          )}
          <div className="space-y-4">
            {(data?.matches ?? []).map((m: Match) => <MatchCard key={m.matchId} match={m} />)}
          </div>
        </div>
      </main>
    </div>
  );
}
