import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { createTestUser, deleteTestUser, supabaseAdmin, type TestUser } from './helpers/users.js';
import { deleteTestMatch } from './helpers/data.js';

describe('Historical matches', () => {
  let coach: TestUser;
  let player: TestUser;
  let player2: TestUser;
  const matchIds: string[] = [];

  beforeAll(async () => {
    [coach, player, player2] = await Promise.all([
      createTestUser('coach', '-hist'),
      createTestUser('player', '-hist1'),
      createTestUser('player', '-hist2'),
    ]);
  });

  afterAll(async () => {
    await Promise.all(matchIds.map(deleteTestMatch));
    await Promise.all([deleteTestUser(coach.userId), deleteTestUser(player.userId), deleteTestUser(player2.userId)]);
  });

  it('creates a completed match with signups + selections for participants', async () => {
    const res = await request(app)
      .post('/api/matches/historical')
      .set('Authorization', `Bearer ${coach.token}`)
      .send({
        matchDate: '2024-09-14',
        opponent: 'Old Rivals',
        matchType: '7-player',
        participantIds: [player.userId, player2.userId],
      });
    expect(res.status).toBe(201);
    const matchId = res.body.data.matchId;
    expect(matchId).toBeTruthy();
    matchIds.push(matchId);

    const { data: match } = await supabaseAdmin.from('matches').select('status, opponent, location').eq('match_id', matchId).single();
    expect(match!.status).toBe('completed');
    expect(match!.opponent).toBe('Old Rivals');

    const { count: signupCount } = await supabaseAdmin.from('signups').select('*', { count: 'exact', head: true }).eq('match_id', matchId);
    const { count: selCount } = await supabaseAdmin.from('selections').select('*', { count: 'exact', head: true }).eq('match_id', matchId);
    expect(signupCount).toBe(2);
    expect(selCount).toBe(2);
  });

  it('then accepts a result via the normal results endpoint', async () => {
    const matchId = matchIds[0];
    const res = await request(app)
      .post(`/api/matches/${matchId}/results`)
      .set('Authorization', `Bearer ${coach.token}`)
      .send({
        goalsFor: 2, goalsAgainst: 1,
        goalEvents: [{ scorerId: player.userId, assisterId: player2.userId }, { scorerId: player.userId, assisterId: null }],
        manOfMatchId: player.userId,
        players: [
          { playerId: player.userId, attended: true, goals: 2, assists: 0 },
          { playerId: player2.userId, attended: true, goals: 0, assists: 1 },
        ],
      });
    expect(res.status).toBe(200);

    // The scorer now has a recorded performance for this match.
    const { data: perf } = await supabaseAdmin
      .from('match_performance').select('goals, attended').eq('match_id', matchId).eq('player_id', player.userId).single();
    expect(perf!.goals).toBe(2);
    expect(perf!.attended).toBe(true);
  });

  it('rejects a historical match from a non-coach', async () => {
    const res = await request(app)
      .post('/api/matches/historical')
      .set('Authorization', `Bearer ${player.token}`)
      .send({ matchDate: '2024-01-01', matchType: '7-player' });
    expect(res.status).toBe(403);
  });

  it('works with no participants (score-only backfill)', async () => {
    const res = await request(app)
      .post('/api/matches/historical')
      .set('Authorization', `Bearer ${coach.token}`)
      .send({ matchDate: '2024-05-01', matchType: 'futsal', participantIds: [] });
    expect(res.status).toBe(201);
    matchIds.push(res.body.data.matchId);
  });
});
