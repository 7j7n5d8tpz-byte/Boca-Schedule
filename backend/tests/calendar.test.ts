import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { createTestUser, deleteTestUser, supabaseAdmin, type TestUser } from './helpers/users.js';
import { createTestMatch, deleteTestMatch, signupPlayer } from './helpers/data.js';

describe('Calendar feed', () => {
  let player: TestUser;
  let matchId: string;
  let token: string;

  beforeAll(async () => {
    player = await createTestUser('player', '-cal');
    const match = await createTestMatch({ status: 'signup_open' });
    matchId = match.match_id;
    await signupPlayer(matchId, player.userId);
    const { data } = await supabaseAdmin.from('users').select('calendar_token').eq('user_id', player.userId).single();
    token = data!.calendar_token;
  });

  afterAll(async () => {
    await deleteTestMatch(matchId);
    await deleteTestUser(player.userId);
  });

  it('returns the current user token + path from /calendar/me', async () => {
    const res = await request(app)
      .get('/api/calendar/me')
      .set('Authorization', `Bearer ${player.token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.token).toBe(token);
    expect(res.body.data.path).toBe(`/api/calendar/${token}.ics`);
  });

  it('serves a valid ICS feed for a valid token, with the signed-up match', async () => {
    const res = await request(app).get(`/api/calendar/${token}.ics`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/calendar');
    expect(res.text).toContain('BEGIN:VCALENDAR');
    expect(res.text).toContain('END:VCALENDAR');
    expect(res.text).toContain(`UID:${matchId}@bocaboldisch.dk`);
    expect(res.text).toContain('SUMMARY:Boca Boldisch');
  });

  it('404s for an unknown token', async () => {
    const res = await request(app).get('/api/calendar/not-a-real-token.ics');
    expect(res.status).toBe(404);
  });

  it('requires auth for /calendar/me', async () => {
    const res = await request(app).get('/api/calendar/me');
    expect(res.status).toBe(401);
  });
});
