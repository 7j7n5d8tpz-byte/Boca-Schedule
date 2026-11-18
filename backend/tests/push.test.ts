import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { createTestUser, deleteTestUser, supabaseAdmin, type TestUser } from './helpers/users.js';

describe('Push subscriptions API', () => {
  let player: TestUser;
  let other: TestUser;
  const endpoint = `https://fcm.googleapis.com/fcm/send/test-${Date.now()}`;
  const body = { endpoint, keys: { p256dh: 'BPubKeyPlaceholder', auth: 'authSecret' } };

  beforeAll(async () => {
    player = await createTestUser('player', '-push');
    other = await createTestUser('player', '-push2');
  });

  afterAll(async () => {
    await supabaseAdmin.from('push_subscriptions').delete().eq('endpoint', endpoint);
    await deleteTestUser(player.userId);
    await deleteTestUser(other.userId);
  });

  it('reports push as off without VAPID keys', async () => {
    const res = await request(app).get('/api/push/config');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ enabled: false, publicKey: null });
  });

  it('requires a login to subscribe', async () => {
    const res = await request(app).post('/api/push/subscriptions').send(body);
    expect(res.status).toBe(401);
  });

  it('rejects endpoints that are not a browser push service', async () => {
    const res = await request(app).post('/api/push/subscriptions')
      .set('Authorization', `Bearer ${player.token}`)
      .send({ ...body, endpoint: 'https://evil.example/hook' });
    expect(res.status).toBe(422);
  });

  it('stores a subscription, and moves it when another player logs in on the device', async () => {
    const res = await request(app).post('/api/push/subscriptions')
      .set('Authorization', `Bearer ${player.token}`).send(body);
    expect(res.status).toBe(201);

    // Same device, re-sent on app start: still one row.
    await request(app).post('/api/push/subscriptions')
      .set('Authorization', `Bearer ${player.token}`).send(body);
    const { data: rows } = await supabaseAdmin.from('push_subscriptions').select('user_id').eq('endpoint', endpoint);
    expect(rows).toEqual([{ user_id: player.userId }]);

    await request(app).post('/api/push/subscriptions')
      .set('Authorization', `Bearer ${other.token}`).send(body);
    const { data: moved } = await supabaseAdmin.from('push_subscriptions').select('user_id').eq('endpoint', endpoint);
    expect(moved).toEqual([{ user_id: other.userId }]);
  });

  it("only deletes the caller's own subscription", async () => {
    await request(app).delete('/api/push/subscriptions')
      .set('Authorization', `Bearer ${player.token}`).send({ endpoint });
    const { count: still } = await supabaseAdmin.from('push_subscriptions')
      .select('*', { count: 'exact', head: true }).eq('endpoint', endpoint);
    expect(still).toBe(1);

    const res = await request(app).delete('/api/push/subscriptions')
      .set('Authorization', `Bearer ${other.token}`).send({ endpoint });
    expect(res.status).toBe(200);
    const { count } = await supabaseAdmin.from('push_subscriptions')
      .select('*', { count: 'exact', head: true }).eq('endpoint', endpoint);
    expect(count).toBe(0);
  });

  it('answers the test endpoint with 503 while push is off', async () => {
    const res = await request(app).post('/api/push/test').set('Authorization', `Bearer ${player.token}`);
    expect(res.status).toBe(503);
  });
});
