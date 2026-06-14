import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { createTestUser, deleteTestUser, supabaseAdmin, type TestUser } from './helpers/users.js';

describe('Auth', () => {
  let player: TestUser;

  beforeAll(async () => {
    player = await createTestUser('player');
  });

  afterAll(async () => {
    await deleteTestUser(player.userId);
  });

  // ── Registration ────────────────────────────────────────────────────────────

  describe('POST /api/auth/register', () => {
    it('creates a new user', async () => {
      const email = `reg-${Date.now()}@bocatest.internal`;
      const res = await request(app).post('/api/auth/register').send({
        email,
        password: 'Test123!',
        name: 'Reg Test',
      });
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      // Cleanup
      const { data } = await supabaseAdmin.from('users').select('user_id').eq('email', email).single();
      if (data?.user_id) await deleteTestUser(data.user_id);
    });

    it('returns 201 even for a duplicate email (no enumeration)', async () => {
      const res = await request(app).post('/api/auth/register').send({
        email: player.email,
        password: 'Test123!',
        name: 'Duplicate',
      });
      expect(res.status).toBe(201);
    });

    it('rejects a weak password', async () => {
      const res = await request(app).post('/api/auth/register').send({
        email: `weak-${Date.now()}@bocatest.internal`,
        password: 'password',
        name: 'Weak Pass',
      });
      expect(res.status).toBe(422);
    });

    it('stores an optional profile picture chosen at sign-up', async () => {
      // 1x1 transparent webp — smallest valid avatar payload.
      const image = 'data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==';
      const email = `reg-avatar-${Date.now()}@bocatest.internal`;
      const res = await request(app).post('/api/auth/register').send({
        email,
        password: 'Test123!',
        name: 'Avatar Signup',
        avatar: image,
      });
      expect(res.status).toBe(201);

      const { data } = await supabaseAdmin.from('users').select('user_id, avatar_url').eq('email', email).single();
      expect(data?.avatar_url).toBeTruthy();
      // Cleanup
      if (data?.user_id) {
        await supabaseAdmin.storage.from('avatars').remove([`${data.user_id}.webp`]);
        await deleteTestUser(data.user_id);
      }
    });

    it('rejects a malformed avatar payload', async () => {
      const res = await request(app).post('/api/auth/register').send({
        email: `reg-badavatar-${Date.now()}@bocatest.internal`,
        password: 'Test123!',
        name: 'Bad Avatar',
        avatar: 'not-a-data-url',
      });
      expect(res.status).toBe(422);
    });
  });

  // ── Login ───────────────────────────────────────────────────────────────────

  describe('POST /api/auth/login', () => {
    it('returns tokens for valid credentials', async () => {
      const res = await request(app).post('/api/auth/login').send({
        email: player.email,
        password: player.password,
      });
      expect(res.status).toBe(200);
      expect(res.body.data.tokens.accessToken).toBeTruthy();
      expect(res.body.data.user.role).toBe('player');
    });

    it('returns 401 for wrong password', async () => {
      const res = await request(app).post('/api/auth/login').send({
        email: player.email,
        password: 'WrongPass1!',
      });
      expect(res.status).toBe(401);
    });

    it('returns 401 for an inactive (pending-approval) account', async () => {
      // Accounts created via /register start as is_active: false until an admin approves them.
      // The response must be identical to a wrong-password 401 to avoid revealing the account exists.
      const email    = `inactive-${Date.now()}@bocatest.internal`;
      const password = 'Test123!';
      const { data: authData } = await supabaseAdmin.auth.admin.createUser({ email, password, email_confirm: true });
      await supabaseAdmin.from('users').insert({
        user_id: authData.user!.id,
        email,
        name: 'Inactive User',
        role: 'player',
        is_active: false,
        preferred_positions: [],
      });

      try {
        const res = await request(app).post('/api/auth/login').send({ email, password });
        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
      } finally {
        await deleteTestUser(authData.user!.id);
      }
    });

    it('returns 401 for unknown email (same message — no enumeration)', async () => {
      const res = await request(app).post('/api/auth/login').send({
        email: 'nobody@bocatest.internal',
        password: 'Test123!',
      });
      expect(res.status).toBe(401);
      // Same message as wrong-password to prevent email enumeration
      const validWrongPassRes = await request(app).post('/api/auth/login').send({
        email: player.email,
        password: 'WrongPass1!',
      });
      expect(res.body.error.message).toBe(validWrongPassRes.body.error.message);
    });
  });

  // ── Token refresh ───────────────────────────────────────────────────────────

  describe('POST /api/auth/refresh', () => {
    it('issues a new access token', async () => {
      const login = await request(app).post('/api/auth/login').send({
        email: player.email,
        password: player.password,
      });
      const { refreshToken } = login.body.data.tokens;
      const res = await request(app).post('/api/auth/refresh').send({ refreshToken });
      expect(res.status).toBe(200);
      expect(res.body.data.accessToken).toBeTruthy();
    });

    it('rejects an invalid refresh token', async () => {
      const res = await request(app).post('/api/auth/refresh').send({ refreshToken: 'garbage' });
      expect(res.status).toBe(401);
    });
  });

  // ── Password reset security ─────────────────────────────────────────────────

  describe('POST /api/auth/reset-password', () => {
    it('accepts a valid recovery session token', async () => {
      // Generate a magic-link hash via the Supabase admin API, then exchange it
      // for a recovery-type session. This is the only way to get a recovery
      // access token without actually sending an email.
      const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
        type: 'recovery',
        email: player.email,
      });
      if (linkErr || !linkData?.properties?.hashed_token) {
        throw new Error(`generateLink failed: ${linkErr?.message}`);
      }

      const { data: sessionData, error: verifyErr } = await supabaseAdmin.auth.verifyOtp({
        token_hash: linkData.properties.hashed_token,
        type: 'recovery',
      });
      if (verifyErr || !sessionData?.session?.access_token) {
        throw new Error(`verifyOtp failed: ${verifyErr?.message}`);
      }

      const res = await request(app).post('/api/auth/reset-password').send({
        accessToken: sessionData.session.access_token,
        newPassword: 'NewSecure1!',
      });
      expect(res.status).toBe(200);

      // Restore original password so other tests are unaffected
      await supabaseAdmin.auth.admin.updateUserById(player.userId, { password: player.password });
    });

    it('rejects a regular session token (must be recovery token)', async () => {
      const res = await request(app).post('/api/auth/reset-password').send({
        accessToken: player.token, // regular login token, not recovery
        newPassword: 'NewPass123!',
      });
      expect(res.status).toBe(401);
    });

    it('rejects missing fields', async () => {
      const res = await request(app).post('/api/auth/reset-password').send({
        newPassword: 'NewPass123!',
      });
      expect(res.status).toBe(422);
    });
  });

  // ── Change password ─────────────────────────────────────────────────────────

  describe('PUT /api/auth/change-password', () => {
    it('requires authentication', async () => {
      const res = await request(app).put('/api/auth/change-password').send({
        currentPassword: player.password,
        newPassword: 'NewPass123!',
      });
      expect(res.status).toBe(401);
    });

    it('rejects wrong current password', async () => {
      const res = await request(app)
        .put('/api/auth/change-password')
        .set('Authorization', `Bearer ${player.token}`)
        .send({ currentPassword: 'WrongPass1!', newPassword: 'NewPass123!' });
      expect(res.status).toBe(401);
    });
  });
});
