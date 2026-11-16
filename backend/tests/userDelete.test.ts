import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { createTestUser, deleteTestUser, supabaseAdmin, type TestUser } from './helpers/users.js';
import { deleteTestMatch } from './helpers/data.js';

describe('Admin: delete user', () => {
  let admin: TestUser;

  beforeAll(async () => {
    admin = await createTestUser('admin', '-del');
  });

  afterAll(async () => {
    await deleteTestUser(admin.userId);
  });

  it('deletes a user nothing depends on — profile and login', async () => {
    const player = await createTestUser('player', '-del-plain');

    const res = await request(app)
      .delete(`/api/admin/users/${player.userId}`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(res.status).toBe(200);

    const { data: profile } = await supabaseAdmin.from('users').select('user_id').eq('user_id', player.userId).maybeSingle();
    expect(profile).toBeNull();
    const login = await request(app).post('/api/auth/login').send({ email: player.email, password: player.password });
    expect(login.status).toBe(401);
  });

  it('refuses a user who created a match, and leaves them fully intact', async () => {
    // matches.created_by is ON DELETE RESTRICT. The login used to be deleted
    // first and the refused profile delete ignored: "deleted", yet still on the
    // list and unable to log in.
    const coach = await createTestUser('coach', '-del-coach');
    const { data: match, error } = await supabaseAdmin.from('matches').insert({
      match_date: '2099-01-01', match_time: '18:00', location: 'Test Pitch', match_type: '7-player',
      status: 'draft', min_players: 5, max_players: 7,
      signup_open_date: '2098-12-01', signup_close_date: '2098-12-31',
      created_by: coach.userId,
    }).select('match_id').single();
    if (error) throw error;

    try {
      const res = await request(app)
        .delete(`/api/admin/users/${coach.userId}`)
        .set('Authorization', `Bearer ${admin.token}`);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('USER_HAS_HISTORY');

      const { data: profile } = await supabaseAdmin.from('users').select('user_id').eq('user_id', coach.userId).maybeSingle();
      expect(profile).not.toBeNull();
      const login = await request(app).post('/api/auth/login').send({ email: coach.email, password: coach.password });
      expect(login.status).toBe(200);
    } finally {
      await deleteTestMatch(match.match_id);
      await deleteTestUser(coach.userId);
    }
  });
});
