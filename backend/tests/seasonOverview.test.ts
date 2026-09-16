import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { cellState, selectionPct } from '../src/lib/seasonOverview.js';
import { createTestUser, deleteTestUser, supabaseAdmin, type TestUser } from './helpers/users.js';
import { createTestMatch, deleteTestMatch, signupPlayer, selectPlayer } from './helpers/data.js';

describe('cellState', () => {
  const base = { signup: null, selected: false, played: false } as const;

  it('completed: played beats everything, selected-but-absent is a no-show', () => {
    expect(cellState({ ...base, status: 'completed', selected: true, played: true })).toBe('played');
    expect(cellState({ ...base, status: 'completed', played: true })).toBe('played'); // walk-on
    expect(cellState({ ...base, status: 'completed', signup: 'active', selected: true })).toBe('no_show');
    expect(cellState({ ...base, status: 'completed', signup: 'active' })).toBe('signed_up');
    expect(cellState({ ...base, status: 'completed' })).toBe('none');
  });

  it('upcoming: selected, signed up, withdrawn, missing only while sign-up is open', () => {
    expect(cellState({ ...base, status: 'published', signup: 'active', selected: true })).toBe('selected');
    expect(cellState({ ...base, status: 'signup_open', signup: 'active' })).toBe('signed_up');
    expect(cellState({ ...base, status: 'signup_open', signup: 'withdrawn' })).toBe('withdrawn');
    expect(cellState({ ...base, status: 'signup_open' })).toBe('missing');
    expect(cellState({ ...base, status: 'signup_closed' })).toBe('none');
  });
});

describe('selectionPct', () => {
  it('counts decided matches only and ignores withdrawals', () => {
    // The coach's sheet: 7 selected out of 8 signups = 87.5%.
    const cells = [
      ...Array.from({ length: 7 }, () => ({ status: 'completed', signup: 'active' as const, selected: true })),
      { status: 'published', signup: 'active' as const, selected: false },
      { status: 'completed', signup: 'withdrawn' as const, selected: false },
      { status: 'signup_open', signup: 'active' as const, selected: false },
    ];
    expect(selectionPct(cells)).toEqual({ selected: 7, considered: 8, pct: 87.5 });
  });

  it('is null with nothing to divide by', () => {
    expect(selectionPct([{ status: 'signup_open', signup: 'active', selected: false }]).pct).toBeNull();
  });
});

// Pinned to a far-future season of its own so no other data lands in it, and so
// the open match isn't auto-completed by the route.
const SEASON = 2031;

describe('GET /api/matches/season-overview', () => {
  let coach: TestUser;
  let regular: TestUser;   // plays, gets dropped once, withdraws once
  let absent: TestUser;    // selected but marked absent
  const matchIds: string[] = [];

  const match = (date: string, status: string) => createTestMatch({
    match_date: date, status, match_type: '11-player',
    signup_open_date: `${SEASON}-01-01T10:00:00Z`, signup_close_date: `${date}T08:00:00Z`,
  }).then(m => { matchIds.push(m.match_id); return m.match_id as string; });

  let completed: string, published: string, open: string, open2: string;

  beforeAll(async () => {
    [coach, regular, absent] = await Promise.all([
      createTestUser('coach', '-season'),
      createTestUser('player', '-season-reg'),
      createTestUser('player', '-season-abs'),
    ]);
    completed = await match(`${SEASON}-03-01`, 'completed');
    published = await match(`${SEASON}-03-08`, 'published');
    open      = await match(`${SEASON}-03-15`, 'signup_open');
    open2     = await match(`${SEASON}-03-22`, 'signup_open');

    // Completed: regular played (no result recorded → selection counts), absent no-show.
    await Promise.all([signupPlayer(completed, regular.userId), signupPlayer(completed, absent.userId)]);
    await Promise.all([selectPlayer(completed, regular.userId), selectPlayer(completed, absent.userId)]);
    await supabaseAdmin.from('match_performance').insert({
      match_id: completed, player_id: absent.userId, attended: false, submitted_by: coach.userId,
    });
    // Published: regular signed up but left out.
    await signupPlayer(published, regular.userId);
    // Open: regular signed up (doesn't count toward %), absent hasn't responded.
    await signupPlayer(open, regular.userId);
    // Open 2: regular withdrew.
    const s = await signupPlayer(open2, regular.userId);
    await supabaseAdmin.from('signups').update({ withdrawn_at: new Date().toISOString() }).eq('signup_id', s.signup_id);
  });

  afterAll(async () => {
    for (const id of matchIds) await deleteTestMatch(id);
    await Promise.all([coach, regular, absent].map(u => deleteTestUser(u.userId)));
  });

  const fetchOverview = (token: string) => request(app)
    .get(`/api/matches/season-overview?year=${SEASON}&matchType=11-player`)
    .set('Authorization', `Bearer ${token}`);

  it('returns the season matches in date order with counts', async () => {
    const res = await fetchOverview(coach.token);
    expect(res.status).toBe(200);
    expect(res.body.data.year).toBe(SEASON);
    expect(res.body.data.matches.map((m: any) => m.matchId)).toEqual([completed, published, open, open2]);
    const c = res.body.data.matches[0];
    expect(c.signupCount).toBe(2);
    expect(c.selectedCount).toBe(2);
    expect(res.body.data.matches[3].signupCount).toBe(0); // withdrawn isn't counted
  });

  it('derives each cell state and the season totals', async () => {
    const res = await fetchOverview(coach.token);
    const byId = new Map(res.body.data.players.map((p: any) => [p.userId, p]));

    const reg: any = byId.get(regular.userId);
    expect(reg.cells).toEqual({ [completed]: 'played', [published]: 'signed_up', [open]: 'signed_up', [open2]: 'withdrawn' });
    expect(reg.played).toBe(1);
    // 1 selected out of 2 decided signups; the open signup and the withdrawal don't count.
    expect(reg.selectionPct).toBe(50);

    const abs: any = byId.get(absent.userId);
    expect(abs.cells).toEqual({ [completed]: 'no_show', [published]: 'none', [open]: 'missing', [open2]: 'missing' });
    expect(abs.played).toBe(0);
    expect(abs.selectionPct).toBe(100);
  });

  it('is forbidden for players', async () => {
    const res = await fetchOverview(regular.token);
    expect(res.status).toBe(403);
  });
});
