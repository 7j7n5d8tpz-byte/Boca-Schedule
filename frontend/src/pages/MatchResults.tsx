import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, Link, useNavigate } from 'react-router-dom';
import html2canvas from 'html2canvas';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import RavenIcon from '../components/RavenIcon';

const POS_COLOR: Record<string, string> = {
  GK:  'bg-yellow-100 text-yellow-700',
  DEF: 'bg-blue-100 text-blue-700',
  WIN: 'bg-green-100 text-green-700',
  MID: 'bg-purple-100 text-purple-700',
  STR: 'bg-red-100 text-red-700',
};

const ASSESSMENT_LABEL: Record<string, { label: string; color: string; bg: string }> = {
  dominated:          { label: 'We dominated',      color: '#15803d', bg: '#f0fdf4' },
  strong_performance: { label: 'Strong performance', color: '#1d4ed8', bg: '#eff6ff' },
  even_game:          { label: 'Evenly matched',     color: '#6b7280', bg: '#f9fafb' },
  unlucky:            { label: 'Unlucky result',     color: '#b45309', bg: '#fffbeb' },
  tough_game:         { label: 'Tough game',         color: '#9333ea', bg: '#faf5ff' },
  off_day:            { label: 'Off day',            color: '#dc2626', bg: '#fef2f2' },
};

interface SelectedPlayer {
  userId: string;
  name: string;
  preferredPositions: string[];
}

interface GoalEntry {
  scorerId: string | null;
  assisterId: string | null;
}

type Step = 'score' | 'goals' | 'cleansheets' | 'cards' | 'assessment';

// ─── Highlights card ──────────────────────────────────────────────────────────

interface GoalDetail {
  scorerName: string | null;
  assisterName: string | null;
}

interface HighlightsProps {
  date: Date;
  goalsFor: number;
  goalsAgainst: number;
  gameAssessment: string | null;
  goalDetails: GoalDetail[];
  cleanSheetNames: string[];
  yellowCardNames: string[];
  redCardNames: string[];
  matchType: string;
}

function HighlightsCard({ props, cardRef }: { props: HighlightsProps; cardRef: React.RefObject<HTMLDivElement> }) {
  const won  = props.goalsFor > props.goalsAgainst;
  const drew = props.goalsFor === props.goalsAgainst;
  const assessment = props.gameAssessment ? ASSESSMENT_LABEL[props.gameAssessment] : null;
  const dateStr = props.date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const hasGoalDetails   = props.goalDetails.length > 0;
  const hasCleanSheets   = props.cleanSheetNames.length > 0;
  const hasYellowCards   = props.yellowCardNames.length > 0;
  const hasRedCards      = props.redCardNames.length > 0;
  const hasCards         = hasYellowCards || hasRedCards;
  const showBottomSection = hasGoalDetails || hasCleanSheets || hasCards;

  return (
    <div ref={cardRef} style={{ fontFamily: 'system-ui, sans-serif', background: '#0f1f0f', width: 480, padding: 32, borderRadius: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24 }}>
        <img src="/boca-logo.png" alt="Boca" style={{ width: 36, height: 36, borderRadius: 18 }} />
        <div>
          <p style={{ color: '#fff', fontWeight: 700, fontSize: 15, margin: 0 }}>Boca Schedule</p>
          <p style={{ color: '#6b9e6b', fontSize: 11, margin: 0, textTransform: 'uppercase', letterSpacing: 1 }}>{props.matchType}</p>
        </div>
        <div style={{ marginLeft: 'auto' }}>
          <p style={{ color: '#9ca3af', fontSize: 12, margin: 0 }}>{dateStr}</p>
        </div>
      </div>

      {/* Score */}
      <div style={{ textAlign: 'center', marginBottom: assessment ? 20 : showBottomSection ? 24 : 0 }}>
        <p style={{ color: '#9ca3af', fontSize: 12, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1 }}>Final score</p>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 20 }}>
          <div style={{ textAlign: 'center' }}>
            <p style={{ color: '#d1fae5', fontSize: 12, marginBottom: 4 }}>Boca</p>
            <p style={{ color: '#fff', fontSize: 64, fontWeight: 800, lineHeight: 1, margin: 0 }}>{props.goalsFor}</p>
          </div>
          <p style={{ color: '#4b5563', fontSize: 32, fontWeight: 300, margin: 0 }}>—</p>
          <div style={{ textAlign: 'center' }}>
            <p style={{ color: '#9ca3af', fontSize: 12, marginBottom: 4 }}>Opponent</p>
            <p style={{ color: '#9ca3af', fontSize: 64, fontWeight: 800, lineHeight: 1, margin: 0 }}>{props.goalsAgainst}</p>
          </div>
        </div>
        <p style={{ marginTop: 12, fontSize: 18, fontWeight: 700, color: won ? '#4ade80' : drew ? '#fbbf24' : '#f87171' }}>
          {won ? 'WIN' : drew ? 'DRAW' : 'LOSS'}
        </p>
      </div>

      {/* Assessment badge */}
      {assessment && (
        <div style={{ textAlign: 'center', marginBottom: showBottomSection ? 24 : 0 }}>
          <span style={{ background: assessment.bg, color: assessment.color, fontSize: 13, fontWeight: 600, padding: '6px 16px', borderRadius: 20, display: 'inline-block' }}>
            {assessment.label}
          </span>
        </div>
      )}

      {/* Goals + clean sheets */}
      {showBottomSection && (
        <div style={{ borderTop: '1px solid #1f2f1f', paddingTop: 20, display: 'flex', gap: 32 }}>
          {/* Goals list */}
          {hasGoalDetails && (
            <div style={{ flex: 1 }}>
              <p style={{ color: '#6b9e6b', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>⚽ Goals</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {props.goalDetails.map((g, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                    <span style={{ color: '#4b5563', fontSize: 11, minWidth: 16 }}>{i + 1}.</span>
                    <div>
                      <span style={{ color: '#d1fae5', fontSize: 13, fontWeight: 600 }}>
                        {g.scorerName ?? 'Own goal'}
                      </span>
                      {g.assisterName && (
                        <span style={{ color: '#86efac', fontSize: 12 }}> · {g.assisterName}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Clean sheets */}
          {hasCleanSheets && (
            <div style={{ flex: 1 }}>
              <p style={{ color: '#6b9e6b', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>🧤 Clean sheet</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {props.cleanSheetNames.map((name, i) => (
                  <span key={i} style={{ color: '#d1fae5', fontSize: 13, fontWeight: 600 }}>{name}</span>
                ))}
              </div>
            </div>
          )}

          {/* Cards */}
          {hasCards && (
            <div style={{ flex: 1 }}>
              <p style={{ color: '#6b9e6b', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>Cards</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {props.yellowCardNames.map((name, i) => (
                  <div key={`y${i}`} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 12 }}>🟨</span>
                    <span style={{ color: '#d1fae5', fontSize: 13, fontWeight: 600 }}>{name}</span>
                  </div>
                ))}
                {props.redCardNames.map((name, i) => (
                  <div key={`r${i}`} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 12 }}>🟥</span>
                    <span style={{ color: '#d1fae5', fontSize: 13, fontWeight: 600 }}>{name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Player button ────────────────────────────────────────────────────────────

function PlayerButton({ player, selected, onClick, disabled }: {
  player: SelectedPlayer; selected: boolean; onClick: () => void; disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border-2 text-sm font-medium transition-colors w-full text-left disabled:opacity-30 disabled:cursor-not-allowed ${
        selected ? 'border-brand-green bg-brand-green-50 text-gray-900' : 'border-gray-200 hover:border-gray-300 text-gray-700'
      }`}
    >
      <span className="flex-1 truncate">{player.name}</span>
      <span className="flex gap-1 shrink-0">
        {player.preferredPositions.map(pos => (
          <span key={pos} className={`text-xs px-1 py-0.5 rounded ${POS_COLOR[pos] ?? 'bg-gray-100 text-gray-500'}`}>{pos}</span>
        ))}
      </span>
    </button>
  );
}

// ─── Step progress ────────────────────────────────────────────────────────────

function StepProgress({ step, goalIndex, goalsFor }: { step: Step; goalIndex: number; goalsFor: number }) {
  const steps = [
    { key: 'score',       label: 'Score' },
    ...(goalsFor > 0 ? [{ key: 'goals', label: step === 'goals' ? `Goal ${goalIndex + 1}/${goalsFor}` : 'Goals' }] : []),
    { key: 'cleansheets', label: 'Clean sheets' },
    { key: 'cards',       label: 'Cards' },
    { key: 'assessment',  label: 'Feeling' },
  ];
  const currentIdx = steps.findIndex(s => s.key === step);
  return (
    <div className="flex items-center gap-1 text-xs flex-wrap">
      {steps.map((s, i) => (
        <span key={s.key} className="flex items-center gap-1">
          {i > 0 && <span className="text-gray-300">›</span>}
          <span className={`font-medium ${i < currentIdx ? 'text-brand-green' : i === currentIdx ? 'text-gray-900' : 'text-gray-300'}`}>
            {s.label}
          </span>
        </span>
      ))}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function MatchResults() {
  const { matchId } = useParams<{ matchId: string }>();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [step, setStep]               = useState<Step>('score');
  const [goalIndex, setGoalIndex]     = useState(0);
  const [goalsFor, setGoalsFor]       = useState(0);
  const [goalsAgainst, setGoalsAgainst] = useState(0);
  const [goalEntries, setGoalEntries] = useState<GoalEntry[]>([]);
  const [cleanSheetIds, setCleanSheetIds] = useState<string[]>([]);
  const [yellowCardIds, setYellowCardIds] = useState<string[]>([]);
  const [redCardIds, setRedCardIds]       = useState<string[]>([]);
  const [gameAssessment, setGameAssessment] = useState<string | null>(null);
  const [showHighlights, setShowHighlights] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError]             = useState('');
  const cardRef = useRef<HTMLDivElement>(null);

  const { data: selectionsData, isLoading: selectionsLoading } = useQuery({
    queryKey: ['match-selections', matchId],
    queryFn: () => api.get(`/matches/${matchId}/selections`).then(r => r.data.data),
  });

  const { data: existingResults, isLoading: resultsLoading } = useQuery({
    queryKey: ['match-results', matchId],
    queryFn: () => api.get(`/matches/${matchId}/results`).then(r => r.data.data),
  });

  // Seed from existing results when editing
  useEffect(() => {
    if (!existingResults?.result) return;
    const gf = existingResults.result.goalsFor;
    setGoalsFor(gf);
    setGoalsAgainst(existingResults.result.goalsAgainst);
    setGameAssessment(existingResults.result.gameAssessment ?? null);

    // Use stored goal_events if available (preserves scorer+assister pairings)
    const stored: GoalEntry[] = (existingResults.result.goalEvents ?? []).map((e: any) => ({
      scorerId: e.scorerId ?? null,
      assisterId: e.assisterId ?? null,
    }));
    // Fall back to per-player totals if no events stored yet
    if (stored.length === 0) {
      for (const p of (existingResults.performances ?? [])) {
        for (let i = 0; i < (p.goals ?? 0); i++) {
          stored.push({ scorerId: p.playerId, assisterId: null });
        }
      }
    }
    while (stored.length < gf) stored.push({ scorerId: null, assisterId: null });
    setGoalEntries(stored.slice(0, gf));
    setCleanSheetIds((existingResults.performances ?? []).filter((p: any) => p.cleanSheet).map((p: any) => p.playerId));
    setYellowCardIds((existingResults.performances ?? []).filter((p: any) => (p.yellowCards ?? 0) > 0).map((p: any) => p.playerId));
    setRedCardIds((existingResults.performances ?? []).filter((p: any) => (p.redCards ?? 0) > 0).map((p: any) => p.playerId));
  }, [existingResults]);

  const selectedPlayers: SelectedPlayer[] = (selectionsData?.players ?? [])
    .filter((p: any) => p.isSelected)
    .map((p: any) => ({ userId: p.player.userId, name: p.player.name, preferredPositions: p.player.preferredPositions ?? [] }));

  function handleContinueFromScore() {
    const entries = Array.from({ length: goalsFor }, (_, i) => goalEntries[i] ?? { scorerId: null, assisterId: null });
    setGoalEntries(entries);
    setGoalIndex(0);
    setStep(goalsFor > 0 ? 'goals' : 'cleansheets');
  }

  function setGoalField(field: 'scorerId' | 'assisterId', value: string | null) {
    setGoalEntries(prev => prev.map((e, i) => i === goalIndex ? { ...e, [field]: value } : e));
  }

  function goToNextGoal() {
    if (goalIndex < goalsFor - 1) setGoalIndex(i => i + 1);
    else setStep('cleansheets');
  }

  function goToPrevGoal() {
    if (goalIndex > 0) setGoalIndex(i => i - 1);
    else setStep('score');
  }

  function toggleCleanSheet(playerId: string) {
    setCleanSheetIds(prev => prev.includes(playerId) ? prev.filter(id => id !== playerId) : [...prev, playerId]);
  }

  function toggleYellowCard(playerId: string) {
    setYellowCardIds(prev => prev.includes(playerId) ? prev.filter(id => id !== playerId) : [...prev, playerId]);
  }

  function toggleRedCard(playerId: string) {
    setRedCardIds(prev => prev.includes(playerId) ? prev.filter(id => id !== playerId) : [...prev, playerId]);
  }

  const saveMutation = useMutation({
    mutationFn: () => {
      const players = selectedPlayers.map(p => ({
        playerId: p.userId,
        attended: true,
        goals:       goalEntries.filter(g => g.scorerId  === p.userId).length,
        assists:     goalEntries.filter(g => g.assisterId === p.userId).length,
        cleanSheet:  cleanSheetIds.includes(p.userId),
        yellowCards: yellowCardIds.includes(p.userId) ? 1 : 0,
        redCards:    redCardIds.includes(p.userId) ? 1 : 0,
      }));
      return api.post(`/matches/${matchId}/results`, { goalsFor, goalsAgainst, gameAssessment, goalEvents: goalEntries, players });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['match-results', matchId] });
      qc.invalidateQueries({ queryKey: ['team-statistics'] });
      qc.invalidateQueries({ queryKey: ['matches'] });
      setShowHighlights(true);
    },
    onError: (err: any) => setError(err.response?.data?.error?.message ?? 'Failed to save'),
  });

  async function downloadHighlights() {
    if (!cardRef.current) return;
    setDownloading(true);
    try {
      const canvas = await html2canvas(cardRef.current, { scale: 2, useCORS: true, backgroundColor: null });
      const link = document.createElement('a');
      const dateLabel = match
        ? new Date(`${match.matchDate}T${match.matchTime}`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }).replace(' ', '-')
        : 'match';
      link.download = `boca-${dateLabel}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } finally {
      setDownloading(false);
    }
  }

  const goalDetails: GoalDetail[] = goalEntries.map(g => ({
    scorerName:   g.scorerId   ? (selectedPlayers.find(p => p.userId === g.scorerId)?.name  ?? 'Unknown') : null,
    assisterName: g.assisterId ? (selectedPlayers.find(p => p.userId === g.assisterId)?.name ?? null)     : null,
  }));

  const cleanSheetNames  = cleanSheetIds.map(id => selectedPlayers.find(p => p.userId === id)?.name ?? 'Unknown');
  const yellowCardNames  = yellowCardIds.map(id => selectedPlayers.find(p => p.userId === id)?.name ?? 'Unknown');
  const redCardNames     = redCardIds.map(id => selectedPlayers.find(p => p.userId === id)?.name ?? 'Unknown');

  if (selectionsLoading || resultsLoading) {
    return <div className="min-h-screen bg-gray-50 boca-page flex items-center justify-center text-gray-400">Loading…</div>;
  }

  const match = selectionsData?.match;
  const date  = match ? new Date(`${match.matchDate}T${match.matchTime}`) : null;
  const currentEntry = goalEntries[goalIndex] ?? { scorerId: null, assisterId: null };

  return (
    <div className="min-h-screen bg-gray-50 boca-page">
      <nav className="bg-brand-dark border-b border-brand-green/40 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="text-white/50 hover:text-white/80 text-sm">← Back</button>
          <span className="text-white/20">|</span>
          <div className="flex items-center gap-2">
            <RavenIcon className="w-8 h-8" />
            <span className="font-bold text-white text-lg">Boca Schedule</span>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-white/70">{user?.name}</span>
          <button onClick={logout} className="text-sm text-white/60 hover:text-white/90">Logout</button>
        </div>
      </nav>

      <main className="max-w-lg mx-auto px-4 py-8 space-y-6">

        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Record match result</h1>
          {date && (
            <p className="text-gray-500 mt-1">
              {date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })} · {match.matchTime.slice(0, 5)}
              {match.opponent && <span className="text-gray-700 font-medium"> · vs {match.opponent}</span>}
            </p>
          )}
          <div className="mt-3">
            <StepProgress step={step} goalIndex={goalIndex} goalsFor={goalsFor} />
          </div>
        </div>

        {/* ── Score ── */}
        {step === 'score' && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-6">
            <h2 className="font-semibold text-gray-900">Final score</h2>
            <div className="flex items-center justify-center gap-8">
              <div className="text-center space-y-3">
                <p className="text-sm font-medium text-gray-500">Boca</p>
                <div className="flex items-center gap-3">
                  <button onClick={() => setGoalsFor(g => Math.max(0, g - 1))} className="w-9 h-9 rounded-full border border-gray-300 text-gray-600 hover:bg-gray-50 text-xl font-light flex items-center justify-center">−</button>
                  <span className="w-10 text-4xl font-bold text-gray-900 text-center tabular-nums">{goalsFor}</span>
                  <button onClick={() => setGoalsFor(g => g + 1)} className="w-9 h-9 rounded-full border border-gray-300 text-gray-600 hover:bg-gray-50 text-xl font-light flex items-center justify-center">+</button>
                </div>
              </div>
              <span className="text-2xl text-gray-300 font-light pb-1">—</span>
              <div className="text-center space-y-3">
                <p className="text-sm font-medium text-gray-500">Opponent</p>
                <div className="flex items-center gap-3">
                  <button onClick={() => setGoalsAgainst(g => Math.max(0, g - 1))} className="w-9 h-9 rounded-full border border-gray-300 text-gray-600 hover:bg-gray-50 text-xl font-light flex items-center justify-center">−</button>
                  <span className="w-10 text-4xl font-bold text-gray-900 text-center tabular-nums">{goalsAgainst}</span>
                  <button onClick={() => setGoalsAgainst(g => g + 1)} className="w-9 h-9 rounded-full border border-gray-300 text-gray-600 hover:bg-gray-50 text-xl font-light flex items-center justify-center">+</button>
                </div>
              </div>
            </div>
            <button
              onClick={handleContinueFromScore}
              className="w-full bg-brand-green hover:bg-brand-green-700 text-white text-sm font-medium py-2.5 rounded-lg transition-colors"
            >
              Continue →
            </button>
          </div>
        )}

        {/* ── Goals ── */}
        {step === 'goals' && goalsFor > 0 && (
          <div className="space-y-4">
            <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-5">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-gray-900">Goal {goalIndex + 1} of {goalsFor}</h2>
                <span className="text-xs text-gray-400 font-mono">{goalsFor} – {goalsAgainst}</span>
              </div>

              {/* Scorer */}
              <div className="space-y-2">
                <p className="text-sm font-medium text-gray-700">Who scored?</p>
                <div className="space-y-1.5 max-h-56 overflow-y-auto">
                  {selectedPlayers.map(p => (
                    <PlayerButton
                      key={p.userId}
                      player={p}
                      selected={currentEntry.scorerId === p.userId}
                      onClick={() => setGoalField('scorerId', currentEntry.scorerId === p.userId ? null : p.userId)}
                    />
                  ))}
                  <button
                    onClick={() => setGoalField('scorerId', null)}
                    className={`w-full text-left px-3 py-2.5 rounded-lg border-2 text-sm transition-colors ${
                      currentEntry.scorerId === null
                        ? 'border-gray-400 bg-gray-50 text-gray-600 font-medium'
                        : 'border-gray-200 text-gray-400 hover:border-gray-300'
                    }`}
                  >
                    Unknown / own goal
                  </button>
                </div>
              </div>

              {/* Assister */}
              <div className="space-y-2">
                <p className="text-sm font-medium text-gray-700">
                  Who assisted? <span className="text-gray-400 font-normal">optional</span>
                </p>
                <div className="space-y-1.5 max-h-56 overflow-y-auto">
                  <button
                    onClick={() => setGoalField('assisterId', null)}
                    className={`w-full text-left px-3 py-2.5 rounded-lg border-2 text-sm transition-colors ${
                      currentEntry.assisterId === null
                        ? 'border-brand-green bg-brand-green-50 text-gray-700 font-medium'
                        : 'border-gray-200 text-gray-400 hover:border-gray-300'
                    }`}
                  >
                    No assist
                  </button>
                  {selectedPlayers.map(p => (
                    <PlayerButton
                      key={p.userId}
                      player={p}
                      selected={currentEntry.assisterId === p.userId}
                      disabled={p.userId === currentEntry.scorerId}
                      onClick={() => setGoalField('assisterId', currentEntry.assisterId === p.userId ? null : p.userId)}
                    />
                  ))}
                </div>
              </div>
            </div>

            <div className="flex gap-2">
              <button onClick={goToPrevGoal} className="flex-1 border border-gray-300 text-gray-700 text-sm font-medium py-2.5 rounded-lg hover:bg-gray-50 transition-colors">
                ← Back
              </button>
              <button onClick={goToNextGoal} className="flex-[2] bg-brand-green hover:bg-brand-green-700 text-white text-sm font-medium py-2.5 rounded-lg transition-colors">
                {goalIndex < goalsFor - 1 ? 'Next goal →' : 'Continue →'}
              </button>
            </div>
          </div>
        )}

        {/* ── Clean sheets ── */}
        {step === 'cleansheets' && (
          <div className="space-y-4">
            <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
              <h2 className="font-semibold text-gray-900">Clean sheets</h2>
              <p className="text-sm text-gray-500">
                {goalsAgainst === 0
                  ? 'Clean sheet! Select who kept goal.'
                  : 'Did any player keep a clean sheet? Leave empty if none.'}
              </p>
              <div className="space-y-1.5">
                {selectedPlayers.map(p => (
                  <PlayerButton
                    key={p.userId}
                    player={p}
                    selected={cleanSheetIds.includes(p.userId)}
                    onClick={() => toggleCleanSheet(p.userId)}
                  />
                ))}
              </div>
              {cleanSheetIds.length === 0 && (
                <p className="text-xs text-gray-400">Nothing selected — no clean sheets recorded.</p>
              )}
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => { setGoalIndex(Math.max(0, goalsFor - 1)); setStep(goalsFor > 0 ? 'goals' : 'score'); }}
                className="flex-1 border border-gray-300 text-gray-700 text-sm font-medium py-2.5 rounded-lg hover:bg-gray-50 transition-colors"
              >
                ← Back
              </button>
              <button
                onClick={() => setStep('cards')}
                className="flex-[2] bg-brand-green hover:bg-brand-green-700 text-white text-sm font-medium py-2.5 rounded-lg transition-colors"
              >
                Continue →
              </button>
            </div>
          </div>
        )}

        {/* ── Cards ── */}
        {step === 'cards' && (
          <div className="space-y-4">
            <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-5">
              <div>
                <h2 className="font-semibold text-gray-900">Cards</h2>
                <p className="text-sm text-gray-500 mt-1">Select any players who received cards. Leave empty if none.</p>
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium text-gray-700">🟨 Yellow cards</p>
                <div className="space-y-1.5">
                  {selectedPlayers.map(p => (
                    <PlayerButton
                      key={p.userId}
                      player={p}
                      selected={yellowCardIds.includes(p.userId)}
                      onClick={() => toggleYellowCard(p.userId)}
                    />
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium text-gray-700">🟥 Red cards</p>
                <div className="space-y-1.5">
                  {selectedPlayers.map(p => (
                    <PlayerButton
                      key={p.userId}
                      player={p}
                      selected={redCardIds.includes(p.userId)}
                      onClick={() => toggleRedCard(p.userId)}
                    />
                  ))}
                </div>
              </div>

              {yellowCardIds.length === 0 && redCardIds.length === 0 && (
                <p className="text-xs text-gray-400">Nothing selected — no cards recorded.</p>
              )}
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setStep('cleansheets')}
                className="flex-1 border border-gray-300 text-gray-700 text-sm font-medium py-2.5 rounded-lg hover:bg-gray-50 transition-colors"
              >
                ← Back
              </button>
              <button
                onClick={() => setStep('assessment')}
                className="flex-[2] bg-brand-green hover:bg-brand-green-700 text-white text-sm font-medium py-2.5 rounded-lg transition-colors"
              >
                Continue →
              </button>
            </div>
          </div>
        )}

        {/* ── Assessment ── */}
        {step === 'assessment' && (
          <div className="space-y-4">
            <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
              <h2 className="font-semibold text-gray-900">How did the game feel?</h2>
              <p className="text-xs text-gray-400">Optional — skip if you prefer.</p>
              <div className="grid grid-cols-2 gap-2">
                {([
                  { key: 'dominated',          label: 'We dominated',      sub: 'Controlled from start to finish' },
                  { key: 'strong_performance', label: 'Strong performance', sub: 'Played well, result reflected the effort' },
                  { key: 'even_game',          label: 'Evenly matched',     sub: 'Could have gone either way' },
                  { key: 'unlucky',            label: 'Unlucky result',     sub: 'Played well but scoreline was harsh' },
                  { key: 'tough_game',         label: 'Tough game',         sub: 'Opponent was strong, we struggled' },
                  { key: 'off_day',            label: 'Off day',            sub: 'Below our usual standard' },
                ] as const).map(opt => (
                  <button
                    key={opt.key}
                    onClick={() => setGameAssessment(prev => prev === opt.key ? null : opt.key)}
                    className={`text-left px-3 py-2.5 rounded-lg border-2 transition-colors ${
                      gameAssessment === opt.key ? 'border-brand-green bg-brand-green-50' : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <p className="text-sm font-medium text-gray-900">{opt.label}</p>
                    <p className="text-xs text-gray-400 mt-0.5 leading-tight">{opt.sub}</p>
                  </button>
                ))}
              </div>
            </div>

            {error && <p className="text-sm text-red-500">{error}</p>}

            <div className="flex gap-2">
              <button
                onClick={() => setStep('cards')}
                className="flex-1 border border-gray-300 text-gray-700 text-sm font-medium py-2.5 rounded-lg hover:bg-gray-50 transition-colors"
              >
                ← Back
              </button>
              <button
                onClick={() => { setError(''); saveMutation.mutate(); }}
                disabled={saveMutation.isPending}
                className="flex-[2] bg-brand-green hover:bg-brand-green-700 disabled:opacity-50 text-white text-sm font-medium py-2.5 rounded-lg transition-colors"
              >
                {saveMutation.isPending ? 'Saving…' : existingResults?.result ? 'Update result' : 'Save result'}
              </button>
            </div>
          </div>
        )}

        {/* ── Highlights overlay ── */}
        {showHighlights && match && date && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
            <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-lg w-full space-y-5">
              <div className="flex items-center justify-between">
                <h2 className="font-bold text-gray-900 text-lg">Result saved!</h2>
                <button onClick={() => navigate(-1)} className="text-gray-400 hover:text-gray-600 text-lg leading-none">✕</button>
              </div>
              <p className="text-sm text-gray-500">Download the highlights card to share with your team.</p>
              <div className="overflow-hidden rounded-xl flex justify-center bg-gray-900">
                <div style={{ zoom: 0.7 }}>
                  <HighlightsCard
                    props={{ date, goalsFor, goalsAgainst, gameAssessment, goalDetails, cleanSheetNames, yellowCardNames, redCardNames, matchType: match.matchType ?? '7-player' }}
                    cardRef={cardRef}
                  />
                </div>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={downloadHighlights}
                  disabled={downloading}
                  className="flex-1 bg-brand-dark hover:bg-gray-800 disabled:opacity-50 text-white text-sm font-medium py-2.5 rounded-lg transition-colors"
                >
                  {downloading ? 'Generating…' : '⬇ Download PNG'}
                </button>
                <button
                  onClick={() => navigate(-1)}
                  className="flex-1 border border-gray-300 text-gray-700 text-sm font-medium py-2.5 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Done →
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
