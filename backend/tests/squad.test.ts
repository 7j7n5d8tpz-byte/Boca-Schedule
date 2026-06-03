import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { createTestUser, deleteTestUser, type TestUser } from './helpers/users.js';
import { createTestMatch, deleteTestMatch, signupPlayer, selectPlayer } from './helpers/data.js';

describe('Squad visibility', () => {
  let player: TestUser;
  let selected: TestUser;
  let openMatchId: string;
  let publishedMatchId: string;

  beforeAll(async () => {
    [player, selected] = await Promise.all([
      createTestUser('player', '-sq1'),
      createTestUser('player', '-sq2'),
    ]);
    const [open, published] = await Promise.all([
      createTestMatch({ status: 'signup_open' }),
      createTestMatch({ status: 'published' }),
    ]);
    openMatchId = open.match_id;
    publishedMatchId = published.match_id;
    await signupPlayer(publishedMatchId, selected.userId);
    await selectPlayer(publishedMatchId, selected.userId);
  });

  afterAll(async () => {
    await Promise.all([deleteTestMatch(openMatchId), deleteTestMatch(publishedMatchId)]);
    await Promise.all([deleteTestUser(player.userId), deleteTestUser(selected.userId)]);
  });

  it('any authenticated player can see the squad of a published match', async () => {
    const res = await request(app)
      .get(`/api/matches/${publishedMatchId}/squad`)
      .set('Authorization', `Bearer ${player.token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.count).toBe(1);
    expect(res.body.data.selected[0].userId).toBe(selected.userId);
    expect(res.body.data.selected[0].name).toBeTruthy();
  });

  it('hides the squad for a match that is not yet published', async () => {
    const res = await request(app)
      .get(`/api/matches/${openMatchId}/squad`)
      .set('Authorization', `Bearer ${player.token}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('NOT_PUBLISHED');
  });

  it('requires authentication', async () => {
    const res = await request(app).get(`/api/matches/${publishedMatchId}/squad`);
    expect(res.status).toBe(401);
  });

  it('404s for an unknown match', async () => {
    const res = await request(app)
      .get('/api/matches/00000000-0000-0000-0000-000000000000/squad')
      .set('Authorization', `Bearer ${player.token}`);
    expect(res.status).toBe(404);
  });
});
