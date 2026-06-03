import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { createTestUser, deleteTestUser, supabaseAdmin, type TestUser } from './helpers/users.js';
import { createTestMatch, deleteTestMatch } from './helpers/data.js';

describe('Announcements', () => {
  let coach: TestUser;
  let player: TestUser;
  let pastMatchId: string;
  const createdIds: string[] = [];

  beforeAll(async () => {
    [coach, player] = await Promise.all([
      createTestUser('coach', '-ann'),
      createTestUser('player', '-ann'),
    ]);
    const past = await createTestMatch({ status: 'published', match_date: '2000-01-01' });
    pastMatchId = past.match_id;
  });

  afterAll(async () => {
    if (createdIds.length) await supabaseAdmin.from('announcements').delete().in('announcement_id', createdIds);
    await deleteTestMatch(pastMatchId);
    await Promise.all([deleteTestUser(coach.userId), deleteTestUser(player.userId)]);
  });

  it('coach can post an announcement', async () => {
    const res = await request(app)
      .post('/api/announcements')
      .set('Authorization', `Bearer ${coach.token}`)
      .send({ body: 'Bring white shirts' });
    expect(res.status).toBe(201);
    expect(res.body.data.announcementId).toBeTruthy();
    createdIds.push(res.body.data.announcementId);
  });

  it('a player can read announcements but cannot post', async () => {
    const get = await request(app)
      .get('/api/announcements')
      .set('Authorization', `Bearer ${player.token}`);
    expect(get.status).toBe(200);
    expect(get.body.data.some((a: any) => a.body === 'Bring white shirts')).toBe(true);

    const post = await request(app)
      .post('/api/announcements')
      .set('Authorization', `Bearer ${player.token}`)
      .send({ body: 'nope' });
    expect(post.status).toBe(403);
  });

  it('rejects an empty announcement', async () => {
    const res = await request(app)
      .post('/api/announcements')
      .set('Authorization', `Bearer ${coach.token}`)
      .send({ body: '   ' });
    expect(res.status).toBe(422);
  });

  it('hides an announcement tied to a past match', async () => {
    const create = await request(app)
      .post('/api/announcements')
      .set('Authorization', `Bearer ${coach.token}`)
      .send({ body: 'Old notice', matchId: pastMatchId });
    expect(create.status).toBe(201);
    createdIds.push(create.body.data.announcementId);

    const get = await request(app)
      .get('/api/announcements')
      .set('Authorization', `Bearer ${player.token}`);
    expect(get.body.data.some((a: any) => a.body === 'Old notice')).toBe(false);
  });

  it('coach can remove an announcement', async () => {
    const create = await request(app)
      .post('/api/announcements')
      .set('Authorization', `Bearer ${coach.token}`)
      .send({ body: 'Temporary' });
    const id = create.body.data.announcementId;

    const del = await request(app)
      .delete(`/api/announcements/${id}`)
      .set('Authorization', `Bearer ${coach.token}`);
    expect(del.status).toBe(200);

    const get = await request(app)
      .get('/api/announcements')
      .set('Authorization', `Bearer ${player.token}`);
    expect(get.body.data.some((a: any) => a.announcementId === id)).toBe(false);
  });
});
