import { describe, it, expect } from 'vitest';
import {
  tiersForValue,
  computeForPlayer,
  computeStreaks,
  computeTeam,
  ACHIEVEMENT_DEFS,
  TIERS,
  type PlayerMatch,
} from '../src/lib/achievements.js';

// Pure engine tests — no database. Validates tier thresholds, tier stacking,
// streak break/continue, and the team computation.

function match(over: Partial<PlayerMatch> & { date: string }): PlayerMatch {
  return {
    matchId: over.date,
    selected: true,
    played: true,
    signedUp: true,
    withdrew: false,
    goals: 0,
    assists: 0,
    cleanSheet: false,
    manOfMatch: false,
    win: null,
    ...over,
  };
}

describe('tiersForValue', () => {
  const t = [1, 3, 6, 10, 15, 22, 30]; // goals_scored thresholds

  it('awards no tier below the first threshold', () => {
    expect(tiersForValue(t, 0)).toEqual({ tiers: [], highest: null, next: 1 });
  });

  it('stacks every tier at or under the value and reports the next target', () => {
    const r = tiersForValue(t, 7);
    expect(r.tiers).toEqual(['bronze', 'silver', 'gold']); // 1,3,6 reached; 10 not
    expect(r.highest).toBe('gold');
    expect(r.next).toBe(10);
  });

  it('caps at legend with no next threshold', () => {
    const r = tiersForValue(t, 999);
    expect(r.highest).toBe('legend');
    expect(r.tiers).toHaveLength(TIERS.length);
    expect(r.next).toBeNull();
  });
});

describe('computeStreaks', () => {
  it('counts the longest and trailing attendance run, skipping non-selected games', () => {
    const matches: PlayerMatch[] = [
      match({ date: '2026-01-01', selected: true, played: true }),
      match({ date: '2026-01-08', selected: true, played: true }),
      match({ date: '2026-01-15', selected: false, played: false }), // not selected → skipped, not a break
      match({ date: '2026-01-22', selected: true, played: true }),
      match({ date: '2026-01-29', selected: true, played: false }), // selected but absent → break
      match({ date: '2026-02-05', selected: true, played: true }),
    ];
    const att = computeStreaks({ seasonYear: 2026, matches }).find(s => s.type === 'attendance')!;
    expect(att.record).toBe(3); // 1,8,(skip),22
    expect(att.current).toBe(1); // trailing run after the absence
  });

  it('breaks a scoring streak on a played match without a goal', () => {
    const matches: PlayerMatch[] = [
      match({ date: '2026-01-01', goals: 1 }),
      match({ date: '2026-01-08', goals: 2 }),
      match({ date: '2026-01-15', goals: 0 }), // break
      match({ date: '2026-01-22', goals: 1 }),
    ];
    const scoring = computeStreaks({ seasonYear: 2026, matches }).find(s => s.type === 'scoring')!;
    expect(scoring.record).toBe(2);
    expect(scoring.current).toBe(1);
  });

  it('treats a draw as breaking the win streak', () => {
    const matches: PlayerMatch[] = [
      match({ date: '2026-01-01', win: true }),
      match({ date: '2026-01-08', win: true }),
      match({ date: '2026-01-15', win: false }), // draw or loss
      match({ date: '2026-01-22', win: true }),
    ];
    const win = computeStreaks({ seasonYear: 2026, matches }).find(s => s.type === 'win')!;
    expect(win.record).toBe(2);
    expect(win.current).toBe(1);
  });
});

describe('computeForPlayer', () => {
  it('sums season output and earns the right tiers', () => {
    const matches: PlayerMatch[] = [
      match({ date: '2026-01-01', goals: 2, assists: 1, cleanSheet: true, manOfMatch: true, played: true }),
      match({ date: '2026-01-08', goals: 1, assists: 0, played: true }),
      match({ date: '2026-01-15', goals: 0, assists: 2, played: true }),
    ];
    const res = computeForPlayer({ seasonYear: 2026, matches });

    const goals = res.groups.find(g => g.code === 'goals_scored')!;
    expect(goals.value).toBe(3);
    expect(goals.highestTier).toBe('silver'); // 1 & 3 reached

    // earned list includes both bronze and silver for goals
    const goalTiers = res.earned.filter(e => e.code === 'goals_scored').map(e => e.tier);
    expect(goalTiers).toEqual(['bronze', 'silver']);

    expect(res.groups.find(g => g.code === 'matches_played')!.value).toBe(3);
    expect(res.groups.find(g => g.code === 'clean_sheets')!.value).toBe(1);
  });

  it('counts only active (non-withdrawn) sign-ups toward signups_made', () => {
    const matches: PlayerMatch[] = [
      match({ date: '2026-01-01', signedUp: true, withdrew: false }),
      match({ date: '2026-01-08', signedUp: true, withdrew: true }), // withdrawn → not counted
      match({ date: '2026-01-15', signedUp: false }),
    ];
    const res = computeForPlayer({ seasonYear: 2026, matches });
    expect(res.groups.find(g => g.code === 'signups_made')!.value).toBe(1);
  });

  it('catalog and engine codes stay in sync', () => {
    const codes = new Set(ACHIEVEMENT_DEFS.map(d => d.code));
    for (const def of ACHIEVEMENT_DEFS) expect(def.thresholds).toHaveLength(TIERS.length);
    expect(codes.has('goals_scored')).toBe(true);
  });
});

describe('computeTeam', () => {
  it('counts wins, clean sheets and the longest winning run', () => {
    const team = computeTeam({
      seasonYear: 2026,
      matches: [
        { date: '2026-01-01', win: true, goalsAgainst: 0 },
        { date: '2026-01-08', win: true, goalsAgainst: 1 },
        { date: '2026-01-15', win: false, goalsAgainst: 2 },
        { date: '2026-01-22', win: true, goalsAgainst: 0 },
      ],
    });
    expect(team.groups.find(g => g.code === 'team_wins')!.value).toBe(3);
    expect(team.groups.find(g => g.code === 'team_clean_sheets')!.value).toBe(2);
    expect(team.groups.find(g => g.code === 'team_win_streak')!.value).toBe(2);
  });
});
