import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { createTestUser, deleteTestUser, supabaseAdmin, type TestUser } from './helpers/users.js';
import { createTestMatch, deleteTestMatch } from './helpers/data.js';

// Notifications are fire-and-forget after the response, so poll for them.
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

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

async function setFlag(userId: string, flag: 'is_fine_admin' | 'can_enter_results', value: boolean) {
  await supabaseAdmin.from('users').update({ [flag]: value }).eq('user_id', userId);
}

async function fineStatus(fineId: string): Promise<string | null> {
  const { data } = await supabaseAdmin.from('fines').select('status').eq('fine_id', fineId).maybeSingle();
  return data?.status ?? null;
}

describe('Fines', () => {
  let admin: TestUser;       // role admin → implicitly a fine admin
  let recorder: TestUser;    // player with can_enter_results
  let player: TestUser;      // plain player
  let target: TestUser;      // plain player who gets fined
  let matchId: string;
  let fineTypeId: string;
  let typeAmount: number;

  beforeAll(async () => {
    [admin, recorder, player, target] = await Promise.all([
      createTestUser('admin', '-fines-admin'),
      createTestUser('player', '-fines-rec'),
      createTestUser('player', '-fines-plain'),
      createTestUser('player', '-fines-target'),
    ]);
    await setFlag(recorder.userId, 'can_enter_results', true);

    const match = await createTestMatch({ status: 'published' });
    matchId = match.match_id;

    const { data: types } = await supabaseAdmin.from('fine_types')
      .select('fine_type_id, amount_dkk').eq('active', true).order('sort_order').limit(1);
    fineTypeId = types![0].fine_type_id;
    typeAmount = types![0].amount_dkk;
  });

  afterAll(async () => {
    // fines cascade on player delete (player_id FK); clean any match-linked rows first
    await supabaseAdmin.from('fines').delete().in('player_id', [admin.userId, recorder.userId, player.userId, target.userId]);
    await deleteTestMatch(matchId);
    await Promise.all([
      deleteTestUser(admin.userId),
      deleteTestUser(recorder.userId),
      deleteTestUser(player.userId),
      deleteTestUser(target.userId),
    ]);
  });

  // ─── Permissions ─────────────────────────────────────────────────────────────

  describe('permissions', () => {
    it('blocks a plain player from issuing a custom fine', async () => {
      const res = await request(app).post('/api/fines').set(auth(player.token))
        .send({ playerId: target.userId, amountDkk: 50, reason: 'x' });
      expect(res.status).toBe(403);
    });

    it('blocks a plain player from issuing a non-match fine', async () => {
      const res = await request(app).post('/api/fines').set(auth(player.token))
        .send({ playerId: target.userId, fineTypeId });
      expect(res.status).toBe(403);
    });

    it('blocks a plain player from the admin views and actions', async () => {
      const adminView = await request(app).get('/api/fines/admin').set(auth(player.token));
      expect(adminView.status).toBe(403);
    });

    it('lets an is_fine_admin-flagged player reach the admin view', async () => {
      await setFlag(player.userId, 'is_fine_admin', true);
      const res = await request(app).get('/api/fines/admin').set(auth(player.token));
      expect(res.status).toBe(200);
      await setFlag(player.userId, 'is_fine_admin', false);
    });

    it('lets a recorder issue a match list-fine, landing in pending_approval', async () => {
      const res = await request(app).post('/api/fines').set(auth(recorder.token))
        .send({ playerId: target.userId, fineTypeId, matchId });
      expect(res.status).toBe(201);
      expect(res.body.data.status).toBe('pending_approval');
    });

    it('auto-approves a fine issued by a fine admin', async () => {
      const res = await request(app).post('/api/fines').set(auth(admin.token))
        .send({ playerId: target.userId, fineTypeId, matchId });
      expect(res.status).toBe(201);
      expect(res.body.data.status).toBe('approved');
      expect(res.body.data.fineId).toBeTruthy();
    });
  });

  // ─── Lifecycle ───────────────────────────────────────────────────────────────

  describe('lifecycle', () => {
    it('issue → notify player, claim → notify admins, confirm → notify player', async () => {
      const issued = await request(app).post('/api/fines').set(auth(admin.token))
        .send({ playerId: target.userId, fineTypeId, matchId });
      const fineId = issued.body.data.fineId;
      expect(await waitForNotification(target.userId, 'fine_issued')).toBe(true);

      // visible to the fined player
      const mine = await request(app).get('/api/fines/my').set(auth(target.token));
      expect(mine.body.data.fines.some((f: any) => f.fineId === fineId)).toBe(true);

      // claim paid
      const claim = await request(app).post(`/api/fines/${fineId}/claim-paid`).set(auth(target.token));
      expect(claim.status).toBe(200);
      expect(await fineStatus(fineId)).toBe('payment_claimed');
      expect(await waitForNotification(admin.userId, 'fine_payment_claimed')).toBe(true);

      // confirm
      const confirm = await request(app).put(`/api/fines/${fineId}/confirm-paid`).set(auth(admin.token));
      expect(confirm.status).toBe(200);
      expect(await fineStatus(fineId)).toBe('paid');
      expect(await waitForNotification(target.userId, 'fine_payment_confirmed')).toBe(true);
    });

    it('reject-claim bounces a claimed fine back to outstanding', async () => {
      const issued = await request(app).post('/api/fines').set(auth(admin.token))
        .send({ playerId: target.userId, fineTypeId, matchId });
      const fineId = issued.body.data.fineId;
      await request(app).post(`/api/fines/${fineId}/claim-paid`).set(auth(target.token));
      const res = await request(app).put(`/api/fines/${fineId}/reject-claim`).set(auth(admin.token));
      expect(res.status).toBe(200);
      expect(await fineStatus(fineId)).toBe('approved');
      expect(await waitForNotification(target.userId, 'fine_claim_rejected')).toBe(true);
    });

    it('lets an admin mark an outstanding fine paid directly (cash) and void another', async () => {
      const a = await request(app).post('/api/fines').set(auth(admin.token))
        .send({ playerId: target.userId, fineTypeId, matchId });
      const cash = await request(app).put(`/api/fines/${a.body.data.fineId}/confirm-paid`).set(auth(admin.token));
      expect(cash.status).toBe(200);
      expect(await fineStatus(a.body.data.fineId)).toBe('paid');

      const b = await request(app).post('/api/fines').set(auth(admin.token))
        .send({ playerId: target.userId, fineTypeId, matchId });
      const voided = await request(app).put(`/api/fines/${b.body.data.fineId}/void`).set(auth(admin.token)).send({ reason: 'wrong player' });
      expect(voided.status).toBe(200);
      expect(await fineStatus(b.body.data.fineId)).toBe('voided');
      expect(await waitForNotification(target.userId, 'fine_voided')).toBe(true);
    });

    it('approves a recorder-issued pending fine', async () => {
      const issued = await request(app).post('/api/fines').set(auth(recorder.token))
        .send({ playerId: target.userId, fineTypeId, matchId });
      const fineId = issued.body.data.fineId;
      expect(await fineStatus(fineId)).toBe('pending_approval');

      const res = await request(app).put(`/api/fines/${fineId}/approve`).set(auth(admin.token)).send({ approve: true });
      expect(res.status).toBe(200);
      expect(await fineStatus(fineId)).toBe('approved');
    });
  });

  // ─── Transparency ──────────────────────────────────────────────────────────────

  describe('transparency', () => {
    it('hides pending/voided fines from the shared team ledger', async () => {
      const pending = await request(app).post('/api/fines').set(auth(recorder.token))
        .send({ playerId: target.userId, fineTypeId, matchId });
      const pendingId = pending.body.data.fineId;

      const ledger = await request(app).get('/api/fines').set(auth(player.token));
      expect(ledger.status).toBe(200);
      const ids = ledger.body.data.map((f: any) => f.fineId);
      expect(ids).not.toContain(pendingId);
      // every visible fine has cleared approval
      expect(ledger.body.data.every((f: any) => ['approved', 'payment_claimed', 'paid'].includes(f.status))).toBe(true);
    });
  });

  // ─── Catalogue + stats ──────────────────────────────────────────────────────────

  describe('catalogue & stats', () => {
    it('restricts fine-type creation to fine admins', async () => {
      const denied = await request(app).post('/api/fine-types').set(auth(player.token))
        .send({ label: 'Nope', amountDkk: 10 });
      expect(denied.status).toBe(403);

      const created = await request(app).post('/api/fine-types').set(auth(admin.token))
        .send({ label: `Test type ${Date.now()}`, amountDkk: 33 });
      expect(created.status).toBe(201);
      const newId = created.body.data.fineTypeId;

      // deactivate → drops out of the active list
      await request(app).delete(`/api/fine-types/${newId}`).set(auth(admin.token));
      const active = await request(app).get('/api/fine-types').set(auth(admin.token));
      expect(active.body.data.some((t: any) => t.fineTypeId === newId)).toBe(false);

      await supabaseAdmin.from('fine_types').delete().eq('fine_type_id', newId);
    });

    it('returns a well-formed stats payload', async () => {
      const res = await request(app).get('/api/fines/stats').set(auth(admin.token));
      expect(res.status).toBe(200);
      const d = res.body.data;
      expect(d.pot).toHaveProperty('collectedDkk');
      expect(d.pot).toHaveProperty('outstandingDkk');
      expect(Array.isArray(d.topFined)).toBe(true);
      expect(Array.isArray(d.topPerGame)).toBe(true);
      expect(Array.isArray(d.typeBreakdown)).toBe(true);
      expect(typeof d.perGameDkk).toBe('number');
    });
  });
});
