import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { createTestUser, deleteTestUser, supabaseAdmin, type TestUser } from './helpers/users.js';
import { createTestMatch, deleteTestMatch, selectPlayer, signupPlayer } from './helpers/data.js';

// Notifications are created fire-and-forget after the response is sent, so poll
// briefly for them rather than asserting synchronously.
async function waitForNotification(userId: string, type: string, timeoutMs = 3000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { data } = await supabaseAdmin.from('notifications')
      .select('notification_id').eq('user_id', userId).eq('type', type).limit(1);
    if ((data ?? []).length > 0) return true;
    await new Promise(r => setTimeout(r, 100));
  }
  return false;
}

describe('Open-spot claims', () => {
  let coach: TestUser;
  let p1: TestUser;
  let p2: TestUser;
  let matchId: string;

  beforeAll(async () => {
    [coach, p1, p2] = await Promise.all([
      createTestUser('coach', '-claim'),
      createTestUser('player', '-claim1'),
      createTestUser('player', '-claim2'),
    ]);
    // Published match with capacity to spare → an open spot exists.
    const match = await createTestMatch({ status: 'published', max_players: 7 });
    matchId = match.match_id;
  });

  afterAll(async () => {
    // spot_claims cascade on match delete
    await deleteTestMatch(matchId);
    await Promise.all([
      deleteTestUser(coach.userId),
      deleteTestUser(p1.userId),
      deleteTestUser(p2.userId),
    ]);
  });

  it('lets a player claim an open spot and notifies the coach', async () => {
    const res = await request(app)
      .post(`/api/matches/${matchId}/claims`)
      .set('Authorization', `Bearer ${p1.token}`);
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('pending');

    expect(await waitForNotification(coach.userId, 'spot_claim')).toBe(true);
  });

  it('rejects a second claim from the same player but reuses the row', async () => {
    const res = await request(app)
      .post(`/api/matches/${matchId}/claims`)
      .set('Authorization', `Bearer ${p1.token}`);
    expect(res.status).toBe(201); // upsert → still one pending claim

    const { data } = await supabaseAdmin.from('spot_claims')
      .select('claim_id').eq('match_id', matchId).eq('claimant_id', p1.userId).eq('status', 'pending');
    expect((data ?? []).length).toBe(1);
  });

  it('lists pending claimants to the coach but not to players', async () => {
    await request(app).post(`/api/matches/${matchId}/claims`).set('Authorization', `Bearer ${p2.token}`);

    const coachRes = await request(app)
      .get(`/api/matches/${matchId}/claims`)
      .set('Authorization', `Bearer ${coach.token}`);
    expect(coachRes.status).toBe(200);
    expect(coachRes.body.data.length).toBe(2);

    const playerRes = await request(app)
      .get(`/api/matches/${matchId}/claims`)
      .set('Authorization', `Bearer ${p1.token}`);
    expect(playerRes.status).toBe(403);
  });

  it('confirming one claim selects that player and auto-rejects the rest', async () => {
    const list = await request(app)
      .get(`/api/matches/${matchId}/claims`)
      .set('Authorization', `Bearer ${coach.token}`);
    const p1Claim = list.body.data.find((c: any) => c.claimantId === p1.userId);

    const res = await request(app)
      .put(`/api/claims/${p1Claim.claimId}/resolve`)
      .set('Authorization', `Bearer ${coach.token}`)
      .send({ accept: true });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('accepted');

    // p1 is now in the squad + signed up
    const { data: sel } = await supabaseAdmin.from('selections')
      .select('player_id').eq('match_id', matchId).eq('player_id', p1.userId);
    expect((sel ?? []).length).toBe(1);
    const { data: sig } = await supabaseAdmin.from('signups')
      .select('signup_id').eq('match_id', matchId).eq('player_id', p1.userId).is('withdrawn_at', null);
    expect((sig ?? []).length).toBe(1);

    // p2's claim was auto-rejected → no pending claims remain
    const after = await request(app)
      .get(`/api/matches/${matchId}/claims`)
      .set('Authorization', `Bearer ${coach.token}`);
    expect(after.body.data.length).toBe(0);

    const { data: p2claim } = await supabaseAdmin.from('spot_claims')
      .select('status').eq('match_id', matchId).eq('claimant_id', p2.userId).single();
    expect(p2claim?.status).toBe('rejected');

    expect(await waitForNotification(p1.userId, 'claim_accepted')).toBe(true);
    expect(await waitForNotification(p2.userId, 'claim_rejected')).toBe(true);
  });

  it('blocks a claim from a player already in the squad', async () => {
    // p1 is selected from the previous test
    const res = await request(app)
      .post(`/api/matches/${matchId}/claims`)
      .set('Authorization', `Bearer ${p1.token}`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('ALREADY_SELECTED');
  });

  it('blocks a claim when the squad is full', async () => {
    const full = await createTestMatch({ status: 'published', max_players: 1 });
    const filler = await createTestUser('player', '-claim-fill');
    try {
      await signupPlayer(full.match_id, filler.userId);
      await selectPlayer(full.match_id, filler.userId);

      const res = await request(app)
        .post(`/api/matches/${full.match_id}/claims`)
        .set('Authorization', `Bearer ${p2.token}`);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('NO_OPEN_SPOT');
    } finally {
      await deleteTestMatch(full.match_id);
      await deleteTestUser(filler.userId);
    }
  });

  it('blocks a claim on a match that is not published', async () => {
    const draft = await createTestMatch({ status: 'signup_open' });
    try {
      const res = await request(app)
        .post(`/api/matches/${draft.match_id}/claims`)
        .set('Authorization', `Bearer ${p2.token}`);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('NOT_PUBLISHED');
    } finally {
      await deleteTestMatch(draft.match_id);
    }
  });

  it('lets a claimant cancel their own pending claim but not someone else’s', async () => {
    const openMatch = await createTestMatch({ status: 'published', max_players: 7 });
    try {
      const claimRes = await request(app)
        .post(`/api/matches/${openMatch.match_id}/claims`)
        .set('Authorization', `Bearer ${p2.token}`);
      const claimId = claimRes.body.data.claimId;

      // Another player cannot cancel it
      const forbidden = await request(app)
        .delete(`/api/claims/${claimId}`)
        .set('Authorization', `Bearer ${p1.token}`);
      expect(forbidden.status).toBe(404);

      // Owner can
      const ok = await request(app)
        .delete(`/api/claims/${claimId}`)
        .set('Authorization', `Bearer ${p2.token}`);
      expect(ok.status).toBe(200);

      const { data } = await supabaseAdmin.from('spot_claims').select('status').eq('claim_id', claimId).single();
      expect(data?.status).toBe('cancelled');
    } finally {
      await deleteTestMatch(openMatch.match_id);
    }
  });

  it('forbids a non-coach from resolving claims', async () => {
    const openMatch = await createTestMatch({ status: 'published', max_players: 7 });
    try {
      const claimRes = await request(app)
        .post(`/api/matches/${openMatch.match_id}/claims`)
        .set('Authorization', `Bearer ${p2.token}`);
      const res = await request(app)
        .put(`/api/claims/${claimRes.body.data.claimId}/resolve`)
        .set('Authorization', `Bearer ${p1.token}`)
        .send({ accept: true });
      expect(res.status).toBe(403);
    } finally {
      await deleteTestMatch(openMatch.match_id);
    }
  });

  it('release announces the open spot to players not in the squad', async () => {
    const relMatch = await createTestMatch({ status: 'published', max_players: 7 });
    const releaser = await createTestUser('player', '-claim-rel');
    try {
      await signupPlayer(relMatch.match_id, releaser.userId);
      await selectPlayer(relMatch.match_id, releaser.userId);

      const res = await request(app)
        .post(`/api/matches/${relMatch.match_id}/release`)
        .set('Authorization', `Bearer ${releaser.token}`);
      expect(res.status).toBe(200);

      // p1/p2 are not in this squad → they should hear about the open spot
      expect(await waitForNotification(p1.userId, 'spot_open')).toBe(true);
      // the releaser should NOT be notified about their own released spot
      const { data } = await supabaseAdmin.from('notifications')
        .select('notification_id').eq('user_id', releaser.userId).eq('type', 'spot_open');
      expect((data ?? []).length).toBe(0);
    } finally {
      await deleteTestMatch(relMatch.match_id);
      await deleteTestUser(releaser.userId);
    }
  });
});
