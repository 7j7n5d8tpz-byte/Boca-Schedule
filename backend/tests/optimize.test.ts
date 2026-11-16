import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { createTestUser, deleteTestUser, supabaseAdmin, type TestUser } from './helpers/users.js';
import { createTestMatch, deleteTestMatch, signupPlayer, selectPlayer, PAST_DATE } from './helpers/data.js';

// Notifications are created fire-and-forget after the response is sent, so poll.
async function waitForNotification(userId: string, type: string, matchId: string, timeoutMs = 3000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { data } = await supabaseAdmin.from('notifications')
      .select('notification_id').eq('user_id', userId).eq('type', type).eq('match_id', matchId).limit(1);
    if (data && data.length > 0) return true;
    await new Promise(r => setTimeout(r, 100));
  }
  return false;
}

describe('Optimizer endpoints and re-publishing', () => {
  let coach: TestUser;
  let kept: TestUser;
  let dropped: TestUser;
  let added: TestUser;
  const matchIds: string[] = [];

  beforeAll(async () => {
    [coach, kept, dropped, added] = await Promise.all([
      createTestUser('coach', '-opt'),
      createTestUser('player', '-opt-kept'),
      createTestUser('player', '-opt-dropped'),
      createTestUser('player', '-opt-added'),
    ]);
  });

  afterAll(async () => {
    for (const id of matchIds) {
      await supabaseAdmin.from('notifications').delete().eq('match_id', id);
      await deleteTestMatch(id);
    }
    await Promise.all([coach, kept, dropped, added].map(u => deleteTestUser(u.userId)));
  });

  async function match(overrides: Record<string, unknown> = {}) {
    const m = await createTestMatch(overrides);
    matchIds.push(m.match_id);
    return m.match_id as string;
  }

  it.each(['completed', 'cancelled'])('refuses to optimize a %s match and leaves its squad alone', async status => {
    const matchId = await match({ status, match_date: PAST_DATE, signup_open_date: '2020-01-01', signup_close_date: '2020-01-02' });
    await signupPlayer(matchId, kept.userId);
    await selectPlayer(matchId, kept.userId);

    for (const call of [
      request(app).post(`/api/matches/${matchId}/optimize`).send({}),
      request(app).post('/api/optimize/batch').send({ matches: [{ matchId }] }),
    ]) {
      const res = await call.set('Authorization', `Bearer ${coach.token}`);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('INVALID_STATE');
    }

    const { data: m } = await supabaseAdmin.from('matches').select('status').eq('match_id', matchId).single();
    expect(m!.status).toBe(status);
    const { data: sel } = await supabaseAdmin.from('selections').select('player_id').eq('match_id', matchId);
    expect(sel).toHaveLength(1);
  });

  it('re-optimizing a published squad remembers who the players last saw in it', async () => {
    const matchId = await match({ status: 'published' });
    await signupPlayer(matchId, kept.userId);
    await signupPlayer(matchId, dropped.userId);
    await selectPlayer(matchId, kept.userId);
    await selectPlayer(matchId, dropped.userId);

    const res = await request(app)
      .post(`/api/matches/${matchId}/optimize`)
      .set('Authorization', `Bearer ${coach.token}`)
      .send({});
    expect(res.status).toBe(200);

    const { data: m } = await supabaseAdmin.from('matches').select('status, optimization_result').eq('match_id', matchId).single();
    expect(m!.status).toBe('optimized');
    expect([...m!.optimization_result.previouslyPublishedIds].sort()).toEqual([kept.userId, dropped.userId].sort());
  });

  it('publishing again tells the dropped and the added player — and only them', async () => {
    // The state a re-optimize leaves behind: un-published, with the squad the
    // players last saw (kept + dropped) on record and a new one (kept + added) picked.
    const matchId = await match({
      status: 'optimized',
      min_players: 1,
      optimization_result: { previouslyPublishedIds: [kept.userId, dropped.userId] },
    });
    await signupPlayer(matchId, kept.userId);
    await signupPlayer(matchId, added.userId);
    await selectPlayer(matchId, kept.userId);
    await selectPlayer(matchId, added.userId);

    const res = await request(app)
      .post(`/api/matches/${matchId}/publish`)
      .set('Authorization', `Bearer ${coach.token}`);
    expect(res.status).toBe(200);

    expect(await waitForNotification(dropped.userId, 'deselected', matchId)).toBe(true);
    expect(await waitForNotification(added.userId, 'selected', matchId)).toBe(true);
    // Nothing changed for this one, so nothing to say. (Checked last: by now
    // the notifications above have been written.)
    expect(await waitForNotification(kept.userId, 'selected', matchId, 300)).toBe(false);

    const { data: m } = await supabaseAdmin.from('matches').select('status, optimization_result').eq('match_id', matchId).single();
    expect(m!.status).toBe('published');
    expect(m!.optimization_result.previouslyPublishedIds).toBeNull();
  });
});
