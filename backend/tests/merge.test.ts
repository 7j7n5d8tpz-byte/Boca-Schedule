import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { createTestUser, deleteTestUser, supabaseAdmin, type TestUser } from './helpers/users.js';
import { createTestMatch, deleteTestMatch, signupPlayer, PAST_DATE } from './helpers/data.js';

// A player who registered twice ends up with two real, loginable accounts. The
// admin merges the old one into the one the player keeps: its history moves
// across and the old account is retired.
describe('Merging a duplicate player account', () => {
  let admin: TestUser;
  let oldAccount: TestUser;
  let newAccount: TestUser;
  let pastMatchId: string;
  let bothMatchId: string;

  beforeAll(async () => {
    [admin, oldAccount, newAccount] = await Promise.all([
      createTestUser('admin', '-merge'),
      createTestUser('player', '-merge-old'),
      createTestUser('player', '-merge-new'),
    ]);
    pastMatchId = (await createTestMatch({ match_date: PAST_DATE })).match_id;
    bothMatchId = (await createTestMatch()).match_id;
  });

  afterAll(async () => {
    await supabaseAdmin.from('notifications').delete().in('user_id', [oldAccount.userId, newAccount.userId]);
    await supabaseAdmin.from('fines').delete().in('player_id', [oldAccount.userId, newAccount.userId]);
    await supabaseAdmin.from('player_achievements').delete().in('player_id', [oldAccount.userId, newAccount.userId]);
    await supabaseAdmin.from('player_streaks').delete().in('player_id', [oldAccount.userId, newAccount.userId]);
    await deleteTestMatch(pastMatchId);
    await deleteTestMatch(bothMatchId);
    await supabaseAdmin.from('users').update({ merged_into: null }).eq('user_id', oldAccount.userId);
    await Promise.all([
      deleteTestUser(admin.userId),
      deleteTestUser(oldAccount.userId),
      deleteTestUser(newAccount.userId),
    ]);
  });

  it('moves the old account\'s history to the kept account and retires it', async () => {
    // History on the old account.
    await signupPlayer(pastMatchId, oldAccount.userId);
    const { data: coach } = await supabaseAdmin.from('matches').select('created_by').eq('match_id', pastMatchId).single();
    await supabaseAdmin.from('match_performance').insert({
      match_id: pastMatchId, player_id: oldAccount.userId, attended: true, goals: 2,
      submitted_by: (coach as any).created_by,
    });
    await supabaseAdmin.from('fines').insert({
      player_id: oldAccount.userId, amount_dkk: 50, reason: 'Late', status: 'approved',
    });
    await supabaseAdmin.from('notifications').insert({
      user_id: oldAccount.userId, type: 'test', title: 'Hello',
    });
    // Both accounts signed up for the same match: the old one is live, the kept
    // one withdrew — the live sign-up must win.
    await signupPlayer(bothMatchId, oldAccount.userId);
    await supabaseAdmin.from('signups').insert({
      match_id: bothMatchId, player_id: newAccount.userId, withdrawn_at: new Date().toISOString(),
    });

    const res = await request(app)
      .post(`/api/admin/users/${oldAccount.userId}/merge`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ targetUserId: newAccount.userId });
    expect(res.status).toBe(200);

    // Nothing is left on the old account…
    for (const [table, col] of [
      ['signups', 'player_id'], ['match_performance', 'player_id'],
      ['fines', 'player_id'], ['notifications', 'user_id'],
    ] as const) {
      const { data } = await supabaseAdmin.from(table).select(col).eq(col, oldAccount.userId);
      expect(data ?? [], table).toHaveLength(0);
    }

    // …it all sits on the kept account…
    const { data: perf } = await supabaseAdmin
      .from('match_performance').select('goals').eq('player_id', newAccount.userId).eq('match_id', pastMatchId).single();
    expect((perf as any).goals).toBe(2);
    const { data: fines } = await supabaseAdmin.from('fines').select('fine_id').eq('player_id', newAccount.userId);
    expect(fines ?? []).toHaveLength(1);
    const { data: both } = await supabaseAdmin
      .from('signups').select('withdrawn_at').eq('player_id', newAccount.userId).eq('match_id', bothMatchId);
    expect(both ?? []).toHaveLength(1);
    expect((both as any)[0].withdrawn_at).toBeNull();

    // …and the old account is a retired tombstone.
    const { data: tomb } = await supabaseAdmin
      .from('users').select('merged_into, is_active').eq('user_id', oldAccount.userId).single();
    expect(tomb).toEqual({ merged_into: newAccount.userId, is_active: false });

    // Its still-valid session is shut out, and it can't log in again.
    const me = await request(app).get('/api/matches/upcoming').set('Authorization', `Bearer ${oldAccount.token}`);
    expect(me.status).toBe(401);
    const login = await request(app).post('/api/auth/login').send({ email: oldAccount.email, password: oldAccount.password });
    expect(login.status).toBe(401);

    // It no longer shows up in the admin user list.
    const list = await request(app)
      .get(`/api/admin/users?search=${encodeURIComponent(oldAccount.email)}`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(list.body.data.users).toHaveLength(0);
  });

  it('refuses to merge into an account that has already been merged away', async () => {
    const res = await request(app)
      .post(`/api/admin/users/${newAccount.userId}/merge`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ targetUserId: oldAccount.userId });
    expect(res.status).toBe(400);
  });

  it('refuses to merge the admin\'s own account away', async () => {
    const res = await request(app)
      .post(`/api/admin/users/${admin.userId}/merge`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ targetUserId: newAccount.userId });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('CANNOT_MERGE_SELF');
  });
});
