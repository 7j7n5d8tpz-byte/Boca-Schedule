import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { createTestUser, deleteTestUser, type TestUser } from './helpers/users.js';
import { createTestMatch, deleteTestMatch, signupPlayer, selectPlayer } from './helpers/data.js';

describe('Matches', () => {
  let coach: TestUser;
  let player: TestUser;
  const createdMatchIds: string[] = [];

  beforeAll(async () => {
    [coach, player] = await Promise.all([
      createTestUser('coach', '-matches'),
      createTestUser('player', '-matches'),
    ]);
  });

  afterAll(async () => {
    await Promise.all(createdMatchIds.map(deleteTestMatch));
    await Promise.all([deleteTestUser(coach.userId), deleteTestUser(player.userId)]);
  });

  // ── Create ──────────────────────────────────────────────────────────────────

  it('coach creates a match', async () => {
    const res = await request(app)
      .post('/api/matches')
      .set('Authorization', `Bearer ${coach.token}`)
      .send({
        matchDate:       '2030-06-15',
        matchTime:       '18:00',
        location:        'Boca Pitch',
        matchType:       '7-player',
        minPlayers:      5,
        maxPlayers:      7,
        signupOpenDate:  new Date(Date.now() - 86_400_000).toISOString(),
        signupCloseDate: new Date('2030-06-14T18:00:00.000Z').toISOString(),
      });
    expect(res.status).toBe(201);
    expect(res.body.data.matchId).toBeTruthy();
    createdMatchIds.push(res.body.data.matchId);
  });

  it('rejects a match with missing required fields', async () => {
    const res = await request(app)
      .post('/api/matches')
      .set('Authorization', `Bearer ${coach.token}`)
      .send({ matchDate: '2030-06-15' }); // missing location, time, type
    expect(res.status).toBe(422);
  });

  // ── Read ────────────────────────────────────────────────────────────────────

  it('authenticated user gets upcoming matches list', async () => {
    const res = await request(app)
      .get('/api/matches/upcoming')
      .set('Authorization', `Bearer ${player.token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.matches)).toBe(true);
  });

  // ── Update ──────────────────────────────────────────────────────────────────

  it('coach updates a match', async () => {
    const match = await createTestMatch();
    createdMatchIds.push(match.match_id);

    const res = await request(app)
      .put(`/api/matches/${match.match_id}`)
      .set('Authorization', `Bearer ${coach.token}`)
      .send({ location: 'Updated Pitch' });
    expect(res.status).toBe(200);
    expect(res.body.data.location).toBe('Updated Pitch');
  });

  // ── Status lifecycle ────────────────────────────────────────────────────────

  it('status transitions: draft → signup_open → signup_closed → optimized', async () => {
    // Future signupOpenDate makes the match start as draft
    const createRes = await request(app)
      .post('/api/matches')
      .set('Authorization', `Bearer ${coach.token}`)
      .send({
        matchDate:       '2030-07-01',
        matchTime:       '18:00',
        location:        'Lifecycle Pitch',
        matchType:       '7-player',
        minPlayers:      1,
        maxPlayers:      7,
        signupOpenDate:  new Date('2030-06-01T00:00:00.000Z').toISOString(),
        signupCloseDate: new Date('2030-06-30T18:00:00.000Z').toISOString(),
      });
    expect(createRes.status).toBe(201);
    const mid = createRes.body.data.matchId;
    createdMatchIds.push(mid);
    expect(createRes.body.data.status).toBe('draft');

    // draft → signup_open
    const openRes = await request(app)
      .put(`/api/matches/${mid}`)
      .set('Authorization', `Bearer ${coach.token}`)
      .send({ status: 'signup_open' });
    expect(openRes.status).toBe(200);
    expect(openRes.body.data.status).toBe('signup_open');

    // signup_open → signup_closed
    const closedRes = await request(app)
      .put(`/api/matches/${mid}`)
      .set('Authorization', `Bearer ${coach.token}`)
      .send({ status: 'signup_closed' });
    expect(closedRes.status).toBe(200);
    expect(closedRes.body.data.status).toBe('signup_closed');

    // signup_closed → optimized (optimizer has run)
    const optimizedRes = await request(app)
      .put(`/api/matches/${mid}`)
      .set('Authorization', `Bearer ${coach.token}`)
      .send({ status: 'optimized' });
    expect(optimizedRes.status).toBe(200);
    expect(optimizedRes.body.data.status).toBe('optimized');
  });

  // ── Publish ─────────────────────────────────────────────────────────────────

  it('cannot publish when fewer than minPlayers are selected', async () => {
    const match = await createTestMatch({ min_players: 5, max_players: 7 });
    createdMatchIds.push(match.match_id);
    // Sign up and select only 1 player (below minPlayers of 5)
    await signupPlayer(match.match_id, player.userId);
    await selectPlayer(match.match_id, player.userId);

    const res = await request(app)
      .post(`/api/matches/${match.match_id}/publish`)
      .set('Authorization', `Bearer ${coach.token}`);
    expect(res.status).toBe(400);
  });

  // ── Guests ──────────────────────────────────────────────────────────────────

  it('coach can add and delete a guest player', async () => {
    const match = await createTestMatch();
    createdMatchIds.push(match.match_id);

    const add = await request(app)
      .post(`/api/matches/${match.match_id}/guests`)
      .set('Authorization', `Bearer ${coach.token}`)
      .send({ name: 'Guest Player', position: 'STR' });
    expect(add.status).toBe(201);
    expect(add.body.data.guestId).toBeTruthy();

    const del = await request(app)
      .delete(`/api/matches/${match.match_id}/guests/${add.body.data.guestId}`)
      .set('Authorization', `Bearer ${coach.token}`);
    expect(del.status).toBe(200);
  });

  it('rejects a guest with an invalid position', async () => {
    const match = await createTestMatch();
    createdMatchIds.push(match.match_id);

    const res = await request(app)
      .post(`/api/matches/${match.match_id}/guests`)
      .set('Authorization', `Bearer ${coach.token}`)
      .send({ name: 'Ghost', position: 'INVALID' });
    expect(res.status).toBe(422);
  });
});
