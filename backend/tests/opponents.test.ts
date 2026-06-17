import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { createTestUser, deleteTestUser, supabaseAdmin, type TestUser } from './helpers/users.js';
import { createTestMatch, deleteTestMatch } from './helpers/data.js';

// Record a completed match result against an opponent so the head-to-head
// aggregation has something to sum over.
async function completedMatchVs(opponentId: string, goalsFor: number, goalsAgainst: number, matchDate: string, matchType = '7-player') {
  const match = await createTestMatch({ status: 'completed', opponent_id: opponentId, match_date: matchDate, match_type: matchType });
  const recordedBy = match.created_by;
  const { error } = await supabaseAdmin.from('match_results').insert({
    match_id: match.match_id,
    goals_for: goalsFor,
    goals_against: goalsAgainst,
    recorded_by: recordedBy,
  });
  if (error) throw error;
  return match;
}

describe('Opponents', () => {
  let coach: TestUser;
  let player: TestUser;
  const createdMatchIds: string[] = [];
  const createdOpponentIds = new Set<string>();

  beforeAll(async () => {
    [coach, player] = await Promise.all([
      createTestUser('coach', '-opponents'),
      createTestUser('player', '-opponents'),
    ]);
  });

  afterAll(async () => {
    await Promise.all(createdMatchIds.map(deleteTestMatch));
    await supabaseAdmin.from('opponents').delete().in('opponent_id', [...createdOpponentIds]);
    await Promise.all([deleteTestUser(coach.userId), deleteTestUser(player.userId)]);
  });

  // ── Find-or-create ────────────────────────────────────────────────────────────

  it('coach creates an opponent', async () => {
    const res = await request(app)
      .post('/api/opponents')
      .set('Authorization', `Bearer ${coach.token}`)
      .send({ name: 'FC Opponents Test' });
    expect(res.status).toBe(201);
    expect(res.body.data.opponentId).toBeTruthy();
    expect(res.body.data.name).toBe('FC Opponents Test');
    createdOpponentIds.add(res.body.data.opponentId);
  });

  it('find-or-create is case/whitespace-insensitive (no duplicate)', async () => {
    const first = await request(app)
      .post('/api/opponents')
      .set('Authorization', `Bearer ${coach.token}`)
      .send({ name: 'Dedup United' });
    createdOpponentIds.add(first.body.data.opponentId);

    const second = await request(app)
      .post('/api/opponents')
      .set('Authorization', `Bearer ${coach.token}`)
      .send({ name: '  dedup united  ' });

    expect(second.status).toBe(201);
    expect(second.body.data.opponentId).toBe(first.body.data.opponentId);
  });

  it('rejects opponent creation by a non-coach', async () => {
    const res = await request(app)
      .post('/api/opponents')
      .set('Authorization', `Bearer ${player.token}`)
      .send({ name: 'Player Cannot Add FC' });
    expect(res.status).toBe(403);
  });

  // ── Match wiring ──────────────────────────────────────────────────────────────

  it('creating a match with opponentId sets both opponent_id and the denormalized name', async () => {
    const opp = await request(app)
      .post('/api/opponents')
      .set('Authorization', `Bearer ${coach.token}`)
      .send({ name: 'Wiring FC' });
    const opponentId = opp.body.data.opponentId;
    createdOpponentIds.add(opponentId);

    const res = await request(app)
      .post('/api/matches')
      .set('Authorization', `Bearer ${coach.token}`)
      .send({
        matchDate:       '2030-08-01',
        matchTime:       '18:00',
        location:        'Boca Pitch',
        matchType:       '7-player',
        minPlayers:      5,
        maxPlayers:      7,
        signupOpenDate:  new Date(Date.now() - 86_400_000).toISOString(),
        signupCloseDate: new Date('2030-07-31T18:00:00.000Z').toISOString(),
        opponentId,
      });
    expect(res.status).toBe(201);
    createdMatchIds.push(res.body.data.matchId);

    const { data: row } = await supabaseAdmin
      .from('matches').select('opponent_id, opponent').eq('match_id', res.body.data.matchId).single();
    expect(row!.opponent_id).toBe(opponentId);
    expect(row!.opponent).toBe('Wiring FC');
  });

  it('creating a match with a new opponent name find-or-creates it', async () => {
    const res = await request(app)
      .post('/api/matches')
      .set('Authorization', `Bearer ${coach.token}`)
      .send({
        matchDate:       '2030-08-02',
        matchTime:       '18:00',
        location:        'Boca Pitch',
        matchType:       '7-player',
        minPlayers:      5,
        maxPlayers:      7,
        signupOpenDate:  new Date(Date.now() - 86_400_000).toISOString(),
        signupCloseDate: new Date('2030-08-01T18:00:00.000Z').toISOString(),
        opponent:        'Freshly Named FC',
      });
    expect(res.status).toBe(201);
    createdMatchIds.push(res.body.data.matchId);

    const { data: row } = await supabaseAdmin
      .from('matches').select('opponent_id, opponent').eq('match_id', res.body.data.matchId).single();
    expect(row!.opponent_id).toBeTruthy();
    expect(row!.opponent).toBe('Freshly Named FC');
    createdOpponentIds.add(row!.opponent_id);
  });

  // ── History aggregation ───────────────────────────────────────────────────────

  it('aggregates head-to-head record and per-match list', async () => {
    const opp = await request(app)
      .post('/api/opponents')
      .set('Authorization', `Bearer ${coach.token}`)
      .send({ name: 'History Rovers' });
    const opponentId = opp.body.data.opponentId;
    createdOpponentIds.add(opponentId);

    // 3-1 win, 0-0 draw, 1-2 loss.
    const m1 = await completedMatchVs(opponentId, 3, 1, '2024-03-01');
    const m2 = await completedMatchVs(opponentId, 0, 0, '2024-05-01');
    const m3 = await completedMatchVs(opponentId, 1, 2, '2024-09-01');
    createdMatchIds.push(m1.match_id, m2.match_id, m3.match_id);

    const res = await request(app)
      .get(`/api/opponents/${opponentId}/history`)
      .set('Authorization', `Bearer ${player.token}`);
    expect(res.status).toBe(200);

    const { summary, matches } = res.body.data;
    expect(summary.played).toBe(3);
    expect(summary.wins).toBe(1);
    expect(summary.draws).toBe(1);
    expect(summary.losses).toBe(1);
    expect(summary.goalsFor).toBe(4);
    expect(summary.goalsAgainst).toBe(3);
    // Chronological — last meeting is the 1-2 loss.
    expect(matches).toHaveLength(3);
    expect(matches[0].matchDate).toBe('2024-03-01');
    expect(summary.lastResult.matchDate).toBe('2024-09-01');
  });

  it('history respects the matchType filter', async () => {
    const opp = await request(app)
      .post('/api/opponents')
      .set('Authorization', `Bearer ${coach.token}`)
      .send({ name: 'Mixed Type FC' });
    const opponentId = opp.body.data.opponentId;
    createdOpponentIds.add(opponentId);

    const a = await completedMatchVs(opponentId, 2, 0, '2024-02-01', '7-player');
    const b = await completedMatchVs(opponentId, 5, 5, '2024-02-08', 'futsal');
    createdMatchIds.push(a.match_id, b.match_id);

    const res = await request(app)
      .get(`/api/opponents/${opponentId}/history?matchType=futsal`)
      .set('Authorization', `Bearer ${player.token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.summary.played).toBe(1);
    expect(res.body.data.matches[0].matchType).toBe('futsal');
  });

  it('lists opponents with matchesPlayed counts', async () => {
    const res = await request(app)
      .get('/api/opponents')
      .set('Authorization', `Bearer ${player.token}`);
    expect(res.status).toBe(200);
    const rovers = res.body.data.find((o: any) => o.name === 'History Rovers');
    expect(rovers).toBeTruthy();
    expect(rovers.matchesPlayed).toBe(3);
  });
});
