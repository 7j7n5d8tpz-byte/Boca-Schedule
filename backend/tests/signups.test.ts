import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { createTestUser, deleteTestUser, supabaseAdmin, type TestUser } from './helpers/users.js';
import { createTestMatch, deleteTestMatch, signupPlayer } from './helpers/data.js';

describe('Signups', () => {
  let player: TestUser;
  let player2: TestUser;
  let coach: TestUser;
  let matchId: string;
  let closedMatchId: string;
  let publishedMatchId: string;

  beforeAll(async () => {
    [player, player2, coach] = await Promise.all([
      createTestUser('player', '-su1'),
      createTestUser('player', '-su2'),
      createTestUser('coach', '-su'),
    ]);
    const [match, closed, published] = await Promise.all([
      createTestMatch({ status: 'signup_open' }),
      createTestMatch({
        status:           'signup_open',
        signup_open_date:  '2000-01-01',
        signup_close_date: '2000-01-02', // window in the past — deadline passed
      }),
      createTestMatch({ status: 'published' }),
    ]);
    matchId         = match.match_id;
    closedMatchId   = closed.match_id;
    publishedMatchId = published.match_id;
    // Seed player's signup into the published match so the withdrawal test can try to delete it
    await signupPlayer(publishedMatchId, player.userId);
  });

  afterAll(async () => {
    await Promise.all([deleteTestMatch(matchId), deleteTestMatch(closedMatchId), deleteTestMatch(publishedMatchId)]);
    await Promise.all([
      deleteTestUser(player.userId),
      deleteTestUser(player2.userId),
      deleteTestUser(coach.userId),
    ]);
  });

  it('player signs up for an open match', async () => {
    const res = await request(app)
      .post('/api/signups')
      .set('Authorization', `Bearer ${player.token}`)
      .send({ matchId });
    expect(res.status).toBe(201);
    expect(res.body.data.signupId).toBeTruthy();
  });

  it('player cannot sign up twice', async () => {
    const res = await request(app)
      .post('/api/signups')
      .set('Authorization', `Bearer ${player.token}`)
      .send({ matchId });
    expect(res.status).toBe(409);
  });

  it('player cannot sign up after deadline', async () => {
    const res = await request(app)
      .post('/api/signups')
      .set('Authorization', `Bearer ${player.token}`)
      .send({ matchId: closedMatchId });
    expect(res.status).toBe(400);
  });

  it('player can withdraw before publish', async () => {
    // sign up player2
    const signup = await request(app)
      .post('/api/signups')
      .set('Authorization', `Bearer ${player2.token}`)
      .send({ matchId });
    expect(signup.status).toBe(201);
    const signupId = signup.body.data.signupId;

    const del = await request(app)
      .delete(`/api/signups/${signupId}`)
      .set('Authorization', `Bearer ${player2.token}`);
    expect(del.status).toBe(200);
  });

  it('player cannot delete another player\'s signup', async () => {
    // Get player's signup id
    const { data } = await supabaseAdmin
      .from('signups')
      .select('signup_id')
      .eq('match_id', matchId)
      .eq('player_id', player.userId)
      .single();
    const signupId = data?.signup_id;

    const res = await request(app)
      .delete(`/api/signups/${signupId}`)
      .set('Authorization', `Bearer ${player2.token}`);
    expect(res.status).toBe(403);
  });

  it('player cannot withdraw after match is published', async () => {
    const { data } = await supabaseAdmin
      .from('signups')
      .select('signup_id')
      .eq('match_id', publishedMatchId)
      .eq('player_id', player.userId)
      .single();

    const res = await request(app)
      .delete(`/api/signups/${data!.signup_id}`)
      .set('Authorization', `Bearer ${player.token}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('WITHDRAWAL_NOT_ALLOWED');
  });

  it('coach can set priority on a signup', async () => {
    const { data } = await supabaseAdmin
      .from('signups')
      .select('signup_id')
      .eq('match_id', matchId)
      .eq('player_id', player.userId)
      .single();

    const res = await request(app)
      .put(`/api/signups/${data!.signup_id}/priority`)
      .set('Authorization', `Bearer ${coach.token}`)
      .send({ isPriority: true });
    expect(res.status).toBe(200);
    expect(res.body.data.isPriority).toBe(true);
  });
});
