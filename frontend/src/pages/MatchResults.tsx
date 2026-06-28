import AppNav from './../components/AppNav';
import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { toPng } from 'html-to-image';
import { api } from '../api/client';
import StatIcon, { CardChip } from '../components/StatIcon';

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

type Step = 'score' | 'goals' | 'goalkeepers' | 'cards' | 'motm' | 'fines' | 'assessment';

// ─── Highlights card ──────────────────────────────────────────────────────────

interface GoalDetail {
  scorerName: string | null;
  assisterName: string | null;
}

interface HighlightsProps {
  date: Date;
  opponent: string | null;
  goalsFor: number;
  goalsAgainst: number;
  gameAssessment: string | null;
  goalDetails: GoalDetail[];
  cleanSheetNames: string[];
  yellowCardNames: string[];
  redCardNames: string[];
  matchType: string;
  manOfMatchName: string | null;
  longRead: string | null;
}

function HighlightsCard({ props, cardRef }: { props: HighlightsProps; cardRef?: React.RefObject<HTMLDivElement | null> }) {
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
    <div ref={cardRef} style={{ fontFamily: 'Archivo, system-ui, sans-serif', background: '#0f1f0f', width: 480, padding: 32, borderRadius: 16 }}>
      {/* Kit stripe — green/crimson/green, full-bleed top accent */}
      <div style={{
        height: 6, marginLeft: -32, marginRight: -32, marginTop: -32, marginBottom: 26,
        borderTopLeftRadius: 16, borderTopRightRadius: 16,
        background: 'linear-gradient(to right, #205B3B 0 38%, #c41230 38% 62%, #205B3B 62% 100%)',
      }} />
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24 }}>
        <img src="/boca-logo.png" alt="Boca" style={{ width: 52, height: 52, borderRadius: 26 }} />
        <div>
          <p style={{ color: '#fff', fontWeight: 700, fontSize: 15, margin: 0 }}>Boca Boldisch</p>
          <p style={{ color: '#6b9e6b', fontSize: 11, margin: 0, textTransform: 'uppercase', letterSpacing: 1 }}>{props.matchType}</p>
        </div>
        <div style={{ marginLeft: 'auto' }}>
          <p style={{ color: '#9ca3af', fontSize: 12, margin: 0 }}>{dateStr}</p>
        </div>
      </div>

      {/* Score */}
      <div style={{ textAlign: 'center', marginBottom: assessment ? 20 : showBottomSection ? 24 : 0 }}>
        <p style={{ color: '#9ca3af', fontSize: 12, marginBottom: 12, textTransform: 'uppercase', letterSpacing: 1 }}>Final score</p>
        {/* Team labels — separate row so the separator aligns with the numbers only */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: 20, marginBottom: 4 }}>
          <p style={{ color: '#d1fae5', fontSize: 12, margin: 0, minWidth: 80, textAlign: 'center' }}>Boca Boldisch</p>
          <div style={{ width: 32 }} />
          <p style={{ color: '#9ca3af', fontSize: 12, margin: 0, minWidth: 80, textAlign: 'center' }}>
            {props.opponent ?? 'Opponent'}
          </p>
        </div>
        {/* Score numbers row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 20 }}>
          <p style={{ color: '#fff', fontSize: 66, fontWeight: 900, lineHeight: 1, margin: 0, minWidth: 80, textAlign: 'center', letterSpacing: -2, fontFeatureSettings: '"tnum" 1' }}>{props.goalsFor}</p>
          <p style={{ color: '#4b5563', fontSize: 32, fontWeight: 300, margin: 0, width: 32, textAlign: 'center' }}>—</p>
          <p style={{ color: '#9ca3af', fontSize: 66, fontWeight: 900, lineHeight: 1, margin: 0, minWidth: 80, textAlign: 'center', letterSpacing: -2, fontFeatureSettings: '"tnum" 1' }}>{props.goalsAgainst}</p>
        </div>
        <p style={{ marginTop: 12, fontSize: 18, fontWeight: 700, color: won ? '#4ade80' : drew ? '#fbbf24' : '#f87171' }}>
          {won ? 'WIN' : drew ? 'DRAW' : 'LOSS'}
        </p>
      </div>

      {/* Assessment badge */}
      {assessment && (
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: props.manOfMatchName || showBottomSection ? 20 : 0 }}>
          <span style={{ background: assessment.bg, color: assessment.color, fontSize: 13, fontWeight: 600, padding: '6px 16px', borderRadius: 20 }}>
            {assessment.label}
          </span>
        </div>
      )}

      {/* Man of the match */}
      {props.manOfMatchName && (
        <div style={{ textAlign: 'center', marginBottom: showBottomSection ? 24 : 0 }}>
          <p style={{ color: '#6b9e6b', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
            <img src="/icon-star-white.png" alt="" style={{ width: 12, height: 12, display: 'inline-block', verticalAlign: 'middle', marginRight: 5, marginTop: -2 }} />
            Man of the Match
          </p>
          <p style={{ color: '#fde68a', fontSize: 16, fontWeight: 700, margin: 0 }}>{props.manOfMatchName}</p>
        </div>
      )}

      {/* Goals + clean sheets */}
      {showBottomSection && (
        <div style={{ borderTop: '1px solid #1f2f1f', paddingTop: 20, display: 'flex', gap: 32 }}>
          {/* Goals list */}
          {hasGoalDetails && (
            <div style={{ flex: 1 }}>
              <p style={{ color: '#6b9e6b', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
                <img src="/icon-ball-white.png" alt="" style={{ width: 12, height: 12, display: 'inline-block', verticalAlign: 'middle', marginRight: 5, marginTop: -2 }} />
                Goals
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {props.goalDetails.map((g, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                    <span style={{ color: '#4b5563', fontSize: 11, minWidth: 16, flexShrink: 0, paddingTop: 1 }}>{i + 1}.</span>
                    <div>
                      <span style={{ color: '#d1fae5', fontSize: 13, fontWeight: 600, display: 'block' }}>
                        {g.scorerName ?? 'Own goal'}
                      </span>
                      {g.assisterName && (
                        <span style={{ color: '#86efac', fontSize: 11, display: 'block' }}>↳ {g.assisterName}</span>
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
              <p style={{ color: '#6b9e6b', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
                <img src="/icon-glove-white.png" alt="" style={{ width: 12, height: 12, display: 'inline-block', verticalAlign: 'middle', marginRight: 5, marginTop: -2 }} />
                Clean sheet
              </p>
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
                    <span style={{ display: 'inline-block', width: 9, height: 12, borderRadius: 2, background: '#facc15', flexShrink: 0 }} />
                    <span style={{ color: '#d1fae5', fontSize: 13, fontWeight: 600 }}>{name}</span>
                  </div>
                ))}
                {props.redCardNames.map((name, i) => (
                  <div key={`r${i}`} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ display: 'inline-block', width: 9, height: 12, borderRadius: 2, background: '#ef4444', flexShrink: 0 }} />
                    <span style={{ color: '#d1fae5', fontSize: 13, fontWeight: 600 }}>{name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Long read / match report */}
      {props.longRead && (
        <div style={{ borderTop: '1px solid #1f2f1f', marginTop: 20, paddingTop: 16 }}>
          <p style={{ color: '#6b9e6b', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Match Report</p>
          <p style={{ color: '#d1d5db', fontSize: 12, lineHeight: 1.6, margin: 0, whiteSpace: 'pre-wrap' }}>{props.longRead}</p>
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
    { key: 'goalkeepers', label: 'Goalkeepers' },
    { key: 'cards',       label: 'Cards' },
    { key: 'motm',        label: 'Man of match' },
    { key: 'fines',       label: 'Fines' },
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
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [step, setStep]               = useState<Step>('score');
  const [goalIndex, setGoalIndex]     = useState(0);
  const [goalsFor, setGoalsFor]       = useState(0);
  const [goalsAgainst, setGoalsAgainst] = useState(0);
  const [goalEntries, setGoalEntries] = useState<GoalEntry[]>([]);
  const [gkFirstHalfCleanSheet,  setGkFirstHalfCleanSheet]  = useState(false);
  const [gkSecondHalfCleanSheet, setGkSecondHalfCleanSheet] = useState(false);
  const [yellowCardIds, setYellowCardIds] = useState<string[]>([]);
  const [redCardIds, setRedCardIds]       = useState<string[]>([]);
  const [gameAssessment, setGameAssessment] = useState<string | null>(null);
  const [motmId, setMotmId]               = useState<string | null>(null);
  const [gkFirstHalfId, setGkFirstHalfId]   = useState<string | null>(null);
  const [gkSecondHalfId, setGkSecondHalfId] = useState<string | null>(null);
  const [longRead, setLongRead]           = useState('');
  const [matchFines, setMatchFines]       = useState<{ playerId: string; fineTypeId: string }[]>([]);
  const [fineDraftPlayer, setFineDraftPlayer] = useState('');
  const [fineDraftType, setFineDraftType]     = useState('');
  const [showHighlights, setShowHighlights] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError]             = useState('');
  const cardRef    = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  const { data: selectionsData, isLoading: selectionsLoading } = useQuery({
    queryKey: ['match-selections', matchId],
    queryFn: () => api.get(`/matches/${matchId}/selections`).then(r => r.data.data),
  });

  const { data: existingResults, isLoading: resultsLoading } = useQuery({
    queryKey: ['match-results', matchId],
    queryFn: () => api.get(`/matches/${matchId}/results`).then(r => r.data.data),
  });

  const { data: fineTypes } = useQuery<{ fineTypeId: string; label: string; amountDkk: number }[]>({
    queryKey: ['fine-types'],
    queryFn: () => api.get('/fine-types').then(r => r.data.data),
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
    setYellowCardIds((existingResults.performances ?? []).filter((p: any) => (p.yellowCards ?? 0) > 0).map((p: any) => p.playerId));
    setRedCardIds((existingResults.performances ?? []).filter((p: any) => (p.redCards ?? 0) > 0).map((p: any) => p.playerId));
    const motmPlayer = (existingResults.performances ?? []).find((p: any) => p.manOfMatch);
    setMotmId(motmPlayer?.playerId ?? null);
    const gkFirst  = existingResults.result.gkFirstHalfId  ?? null;
    const gkSecond = existingResults.result.gkSecondHalfId ?? null;
    setGkFirstHalfId(gkFirst);
    setGkSecondHalfId(gkSecond);
    const existingCsIds = new Set((existingResults.performances ?? []).filter((p: any) => p.cleanSheet).map((p: any) => p.playerId));
    setGkFirstHalfCleanSheet(!!gkFirst  && existingCsIds.has(gkFirst));
    setGkSecondHalfCleanSheet(!!gkSecond && existingCsIds.has(gkSecond));
    setLongRead(existingResults.result.longRead ?? '');
  }, [existingResults]);

  // Build player pool: selected players → all signed-up players → existing performances (editing fallback)
  const selectedPlayers: SelectedPlayer[] = (() => {
    const fromSelections = (selectionsData?.players ?? [])
      .filter((p: any) => p.isSelected)
      .map((p: any) => ({ userId: p.player.userId, name: p.player.name, preferredPositions: p.player.preferredPositions ?? [] }));
    if (fromSelections.length > 0) return fromSelections;

    // GET /selections now returns the full roster (so the squad editor can add
    // non-signups); restrict this fallback to players who actually signed up.
    const fromSignups = (selectionsData?.players ?? [])
      .filter((p: any) => p.isSignedUp)
      .map((p: any) => ({ userId: p.player.userId, name: p.player.name, preferredPositions: p.player.preferredPositions ?? [] }));
    if (fromSignups.length > 0) return fromSignups;

    // When no signups exist (e.g. simulation data), fall back to previously-saved performances
    return (existingResults?.performances ?? [])
      .map((p: any) => ({ userId: p.playerId, name: p.name, preferredPositions: p.preferredPositions ?? [] }));
  })();

  function handleContinueFromScore() {
    const entries = Array.from({ length: goalsFor }, (_, i) => goalEntries[i] ?? { scorerId: null, assisterId: null });
    setGoalEntries(entries);
    setGoalIndex(0);
    setStep(goalsFor > 0 ? 'goals' : 'goalkeepers');
  }

  function setGoalField(field: 'scorerId' | 'assisterId', value: string | null) {
    setGoalEntries(prev => prev.map((e, i) => i === goalIndex ? { ...e, [field]: value } : e));
  }

  function goToNextGoal() {
    if (goalIndex < goalsFor - 1) setGoalIndex(i => i + 1);
    else setStep('goalkeepers');
  }

  function goToPrevGoal() {
    if (goalIndex > 0) setGoalIndex(i => i - 1);
    else setStep('score');
  }

  function toggleYellowCard(playerId: string) {
    setYellowCardIds(prev => prev.includes(playerId) ? prev.filter(id => id !== playerId) : [...prev, playerId]);
  }

  function toggleRedCard(playerId: string) {
    setRedCardIds(prev => prev.includes(playerId) ? prev.filter(id => id !== playerId) : [...prev, playerId]);
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const csIds = new Set<string>();
      if (gkFirstHalfId  && gkFirstHalfCleanSheet)  csIds.add(gkFirstHalfId);
      if (gkSecondHalfId && gkSecondHalfCleanSheet) csIds.add(gkSecondHalfId);
      const players = selectedPlayers.map(p => ({
        playerId: p.userId,
        attended: true,
        goals:       goalEntries.filter(g => g.scorerId  === p.userId).length,
        assists:     goalEntries.filter(g => g.assisterId === p.userId).length,
        cleanSheet:  csIds.has(p.userId),
        yellowCards: yellowCardIds.includes(p.userId) ? 1 : 0,
        redCards:    redCardIds.includes(p.userId) ? 1 : 0,
      }));
      const res = await api.post(`/matches/${matchId}/results`, { goalsFor, goalsAgainst, gameAssessment, goalEvents: goalEntries, longRead: longRead || null, manOfMatchId: motmId, gkFirstHalfId, gkSecondHalfId, players });
      // Submit any fines added in this session, then clear so a re-save can't duplicate them.
      if (matchFines.length > 0) {
        await Promise.all(matchFines.map(f => api.post('/fines', { playerId: f.playerId, fineTypeId: f.fineTypeId, matchId })));
        setMatchFines([]);
      }
      return res;
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
      // Make sure the Archivo weights the card uses are loaded before capturing —
      // otherwise the big score digits rasterize in a fallback font with
      // mismatched metrics.
      if (document.fonts) {
        await Promise.all(
          ['600 16px Archivo', '700 16px Archivo', '800 16px Archivo', '900 66px Archivo']
            .map(f => document.fonts.load(f)),
        ).catch(() => {});
        await document.fonts.ready;
      }
      // Render at 2× via the browser's own layout engine (SVG foreignObject).
      // Safari/WebKit captures the first pass before embedded resources (the crest
      // <img>, fonts) finish loading into the cloned SVG, producing a broken card
      // with a missing logo and shifted header. Rendering a few passes lets those
      // resources settle so the final capture is complete. See html-to-image #361.
      let dataUrl = '';
      for (let i = 0; i < 3; i++) {
        dataUrl = await toPng(cardRef.current, { pixelRatio: 2, cacheBust: true });
      }
      const link = document.createElement('a');
      const dateLabel = match
        ? new Date(`${match.matchDate}T${match.matchTime}`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }).replace(' ', '-')
        : 'match';
      link.download = `boca-${dateLabel}.png`;
      link.href = dataUrl;
      link.click();
    } finally {
      setDownloading(false);
    }
  }

  const goalDetails: GoalDetail[] = goalEntries.map(g => ({
    scorerName:   g.scorerId   ? (selectedPlayers.find(p => p.userId === g.scorerId)?.name  ?? 'Unknown') : null,
    assisterName: g.assisterId ? (selectedPlayers.find(p => p.userId === g.assisterId)?.name ?? null)     : null,
  }));

  const cleanSheetIds   = [...new Set([
    ...(gkFirstHalfId  && gkFirstHalfCleanSheet  ? [gkFirstHalfId]  : []),
    ...(gkSecondHalfId && gkSecondHalfCleanSheet ? [gkSecondHalfId] : []),
  ])];
  const cleanSheetNames  = cleanSheetIds.map(id => selectedPlayers.find(p => p.userId === id)?.name ?? 'Unknown');
  const yellowCardNames  = yellowCardIds.map(id => selectedPlayers.find(p => p.userId === id)?.name ?? 'Unknown');
  const redCardNames     = redCardIds.map(id => selectedPlayers.find(p => p.userId === id)?.name ?? 'Unknown');
  const manOfMatchName   = motmId ? (selectedPlayers.find(p => p.userId === motmId)?.name ?? null) : null;

  if (selectionsLoading || resultsLoading) {
    return <div className="min-h-screen bg-gray-50 boca-page flex items-center justify-center text-gray-400">Loading…</div>;
  }

  const match = selectionsData?.match;
  const date  = match ? new Date(`${match.matchDate}T${match.matchTime}`) : null;
  const currentEntry = goalEntries[goalIndex] ?? { scorerId: null, assisterId: null };

  return (
    <div className="min-h-screen bg-gray-50 boca-page">
      <AppNav onBack={() => navigate(-1)} />

      <main className="max-w-lg mx-auto px-4 py-8 space-y-6">

        {/* Header */}
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900">Record match result</h1>
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

        {/* ── Goalkeepers + Clean sheets ── */}
        {step === 'goalkeepers' && (
          <div className="space-y-4">
            <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-5">
              <div>
                <h2 className="font-semibold text-gray-900">Goalkeepers</h2>
                <p className="text-sm text-gray-500 mt-1">Who played in goal each half, and did they keep a clean sheet?</p>
              </div>

              {/* 1st half */}
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <p className="text-sm font-medium text-gray-700">1st half goalkeeper</p>
                  <select
                    value={gkFirstHalfId ?? ''}
                    onChange={e => {
                      const val = e.target.value || null;
                      setGkFirstHalfId(val);
                      if (!val) setGkFirstHalfCleanSheet(false);
                    }}
                    className="w-full px-3 py-2.5 rounded-lg border border-gray-200 bg-white text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-brand-green appearance-none"
                  >
                    <option value="">Unknown</option>
                    {selectedPlayers.map(p => (
                      <option key={p.userId} value={p.userId}>{p.name}</option>
                    ))}
                  </select>
                </div>
                <button
                  onClick={() => setGkFirstHalfCleanSheet(prev => !prev)}
                  disabled={!gkFirstHalfId}
                  className={`flex items-center justify-between w-full px-4 py-3 rounded-lg border transition-colors ${
                    !gkFirstHalfId
                      ? 'border-gray-100 bg-gray-50 opacity-40 cursor-not-allowed'
                      : gkFirstHalfCleanSheet
                        ? 'border-brand-green bg-brand-green-50'
                        : 'border-gray-200 bg-white hover:bg-gray-50'
                  }`}
                >
                  <span className={`text-sm font-medium flex items-center gap-1.5 ${gkFirstHalfCleanSheet ? 'text-brand-green-700' : 'text-gray-700'}`}>
                    <StatIcon name="glove" className="w-4 h-4" /> Clean sheet
                  </span>
                  <div className={`relative w-11 h-6 rounded-full transition-colors duration-200 ${gkFirstHalfCleanSheet ? 'bg-brand-green' : 'bg-gray-300'}`}>
                    <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform duration-200 ${gkFirstHalfCleanSheet ? 'translate-x-6' : 'translate-x-1'}`} />
                  </div>
                </button>
              </div>

              <div className="border-t border-gray-100" />

              {/* 2nd half */}
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <p className="text-sm font-medium text-gray-700">2nd half goalkeeper</p>
                  <select
                    value={gkSecondHalfId ?? ''}
                    onChange={e => {
                      const val = e.target.value || null;
                      setGkSecondHalfId(val);
                      if (!val) setGkSecondHalfCleanSheet(false);
                    }}
                    className="w-full px-3 py-2.5 rounded-lg border border-gray-200 bg-white text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-brand-green appearance-none"
                  >
                    <option value="">Unknown</option>
                    {selectedPlayers.map(p => (
                      <option key={p.userId} value={p.userId}>{p.name}</option>
                    ))}
                  </select>
                </div>
                <button
                  onClick={() => setGkSecondHalfCleanSheet(prev => !prev)}
                  disabled={!gkSecondHalfId}
                  className={`flex items-center justify-between w-full px-4 py-3 rounded-lg border transition-colors ${
                    !gkSecondHalfId
                      ? 'border-gray-100 bg-gray-50 opacity-40 cursor-not-allowed'
                    : gkSecondHalfCleanSheet
                        ? 'border-brand-green bg-brand-green-50'
                        : 'border-gray-200 bg-white hover:bg-gray-50'
                  }`}
                >
                  <span className={`text-sm font-medium flex items-center gap-1.5 ${gkSecondHalfCleanSheet ? 'text-brand-green-700' : 'text-gray-700'}`}>
                    <StatIcon name="glove" className="w-4 h-4" /> Clean sheet
                  </span>
                  <div className={`relative w-11 h-6 rounded-full transition-colors duration-200 ${gkSecondHalfCleanSheet ? 'bg-brand-green' : 'bg-gray-300'}`}>
                    <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform duration-200 ${gkSecondHalfCleanSheet ? 'translate-x-6' : 'translate-x-1'}`} />
                  </div>
                </button>
              </div>
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
                <p className="text-sm font-medium text-gray-700 flex items-center gap-1.5"><CardChip color="yellow" /> Yellow cards</p>
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
                <p className="text-sm font-medium text-gray-700 flex items-center gap-1.5"><CardChip color="red" /> Red cards</p>
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
                onClick={() => setStep('goalkeepers')}
                className="flex-1 border border-gray-300 text-gray-700 text-sm font-medium py-2.5 rounded-lg hover:bg-gray-50 transition-colors"
              >
                ← Back
              </button>
              <button
                onClick={() => setStep('motm')}
                className="flex-[2] bg-brand-green hover:bg-brand-green-700 text-white text-sm font-medium py-2.5 rounded-lg transition-colors"
              >
                Continue →
              </button>
            </div>
          </div>
        )}

        {/* ── Man of the match ── */}
        {step === 'motm' && (
          <div className="space-y-4">
            <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
              <h2 className="font-semibold text-gray-900">Man of the match</h2>
              <p className="text-xs text-gray-400">Optional — leave unselected if you prefer.</p>
              <div className="space-y-1.5">
                <button
                  onClick={() => setMotmId(null)}
                  className={`w-full text-left px-3 py-2.5 rounded-lg border-2 text-sm transition-colors ${
                    motmId === null
                      ? 'border-brand-green bg-brand-green-50 text-gray-700 font-medium'
                      : 'border-gray-200 text-gray-400 hover:border-gray-300'
                  }`}
                >
                  No man of the match
                </button>
                {selectedPlayers.map(p => (
                  <PlayerButton
                    key={p.userId}
                    player={p}
                    selected={motmId === p.userId}
                    onClick={() => setMotmId(prev => prev === p.userId ? null : p.userId)}
                  />
                ))}
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setStep('cards')}
                className="flex-1 border border-gray-300 text-gray-700 text-sm font-medium py-2.5 rounded-lg hover:bg-gray-50 transition-colors"
              >
                ← Back
              </button>
              <button
                onClick={() => setStep('fines')}
                className="flex-[2] bg-brand-green hover:bg-brand-green-700 text-white text-sm font-medium py-2.5 rounded-lg transition-colors"
              >
                Continue →
              </button>
            </div>
          </div>
        )}

        {/* ── Fines ── */}
        {step === 'fines' && (
          <div className="space-y-4">
            <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
              <h2 className="font-semibold text-gray-900">Fines</h2>
              <p className="text-xs text-gray-400">
                Optional — add any fines from this match. A fine admin approves them before they count
                (unless you are one, in which case they apply right away).
              </p>

              {/* Added fines */}
              {matchFines.length > 0 && (
                <div className="space-y-1.5">
                  {matchFines.map((f, i) => {
                    const player = selectedPlayers.find(p => p.userId === f.playerId);
                    const type = (fineTypes ?? []).find(t => t.fineTypeId === f.fineTypeId);
                    return (
                      <div key={i} className="flex items-center justify-between gap-2 bg-gray-50 rounded-lg px-3 py-2 text-sm">
                        <span className="truncate text-gray-800">{player?.name ?? 'Player'} · {type?.label ?? 'Fine'}</span>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-gray-500">{type ? `${type.amountDkk} kr` : ''}</span>
                          <button onClick={() => setMatchFines(prev => prev.filter((_, j) => j !== i))} className="text-gray-400 hover:text-red-500">✕</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Add a fine */}
              <div className="flex flex-col sm:flex-row gap-2 pt-1">
                <select
                  value={fineDraftPlayer}
                  onChange={e => setFineDraftPlayer(e.target.value)}
                  className="flex-1 min-w-0 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green bg-white"
                >
                  <option value="">Player…</option>
                  {selectedPlayers.map(p => <option key={p.userId} value={p.userId}>{p.name}</option>)}
                </select>
                <select
                  value={fineDraftType}
                  onChange={e => setFineDraftType(e.target.value)}
                  className="flex-1 min-w-0 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green bg-white"
                >
                  <option value="">Fine…</option>
                  {(fineTypes ?? []).map(t => <option key={t.fineTypeId} value={t.fineTypeId}>{t.label} — {t.amountDkk} kr</option>)}
                </select>
                <button
                  onClick={() => {
                    if (!fineDraftPlayer || !fineDraftType) return;
                    setMatchFines(prev => [...prev, { playerId: fineDraftPlayer, fineTypeId: fineDraftType }]);
                    setFineDraftPlayer(''); setFineDraftType('');
                  }}
                  disabled={!fineDraftPlayer || !fineDraftType}
                  className="bg-brand-dark text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-40 shrink-0"
                >
                  Add
                </button>
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setStep('motm')}
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

              {/* Long read */}
              <div className="space-y-2 pt-1">
                <p className="text-sm font-medium text-gray-700">Match report <span className="text-gray-400 font-normal">optional</span></p>
                <textarea
                  value={longRead}
                  onChange={e => setLongRead(e.target.value)}
                  placeholder="Write a brief match report…"
                  rows={4}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm text-gray-900 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-brand-green resize-none"
                />
              </div>
            </div>

            {error && <p className="text-sm text-red-500">{error}</p>}

            <div className="flex gap-2">
              <button
                onClick={() => setStep('fines')}
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
          <>
            {/* Full-size off-screen card — html2canvas captures this, no zoom distortion */}
            <div aria-hidden="true" style={{ position: 'fixed', left: -9999, top: 0, pointerEvents: 'none' }}>
              <HighlightsCard
                props={{ date, opponent: match.opponent ?? null, goalsFor, goalsAgainst, gameAssessment, goalDetails, cleanSheetNames, yellowCardNames, redCardNames, matchType: match.matchType ?? '7-player', manOfMatchName, longRead: longRead || null }}
                cardRef={cardRef}
              />
            </div>

            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
              <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-lg w-full space-y-5 boca-pop">
                <div className="flex items-center justify-between">
                  <h2 className="font-bold text-gray-900 text-lg">Result saved!</h2>
                  <button onClick={() => navigate(-1)} className="text-gray-400 hover:text-gray-600 text-lg leading-none">✕</button>
                </div>
                <p className="text-sm text-gray-500">Download the highlights card to share with your team.</p>
                {/* Zoomed preview only — no capture ref */}
                <div className="overflow-hidden rounded-xl flex justify-center bg-gray-900">
                  <div style={{ zoom: 0.7 }}>
                    <HighlightsCard
                      props={{ date, opponent: match.opponent ?? null, goalsFor, goalsAgainst, gameAssessment, goalDetails, cleanSheetNames, yellowCardNames, redCardNames, matchType: match.matchType ?? '7-player', manOfMatchName, longRead: longRead || null }}
                      cardRef={previewRef}
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
          </>
        )}
      </main>
    </div>
  );
}
