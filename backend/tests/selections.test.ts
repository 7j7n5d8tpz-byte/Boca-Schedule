import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { createTestUser, deleteTestUser, supabaseAdmin, type TestUser } from './helpers/users.js';
import { createTestMatch, deleteTestMatch, signupPlayer } from './helpers/data.js';

describe('Selections', () => {
  let coach: TestUser;
  let player: TestUser;
  let matchId: string;

  beforeAll(async () => {
    [coach, player] = await Promise.all([
      createTestUser('coach', '-sel'),
      createTestUser('player', '-sel'),
    ]);
    const match = await createTestMatch();
    matchId = match.match_id;
    await signupPlayer(matchId, player.userId);
  });

  afterAll(async () => {
    await deleteTestMatch(matchId);
    await Promise.all([deleteTestUser(coach.userId), deleteTestUser(player.userId)]);
  });

  it('GET selections returns the player list with isSelected flag', async () => {
    const res = await request(app)
      .get(`/api/matches/${matchId}/selections`)
      .set('Authorization', `Bearer ${coach.token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.players)).toBe(true);
    const entry = res.body.data.players.find((p: any) => p.player.userId === player.userId);
    expect(entry).toBeTruthy();
    expect(entry.isSelected).toBe(false);
  });

  it('PUT selections with valid signed-up player saves correctly', async () => {
    const res = await request(app)
      .put(`/api/matches/${matchId}/selections`)
      .set('Authorization', `Bearer ${coach.token}`)
      .send({ selectedPlayerIds: [player.userId] });
    expect(res.status).toBe(200);
    expect(res.body.data.selectedCount).toBe(1);

    // Verify isSelected is now true
    const check = await request(app)
      .get(`/api/matches/${matchId}/selections`)
      .set('Authorization', `Bearer ${coach.token}`);
    const entry = check.body.data.players.find((p: any) => p.player.userId === player.userId);
    expect(entry.isSelected).toBe(true);
  });

  it('PUT selections rejects a player not signed up for this match (security fix)', async () => {
    const notSignedUp = await createTestUser('player', '-sel-not');
    try {
      const res = await request(app)
        .put(`/api/matches/${matchId}/selections`)
        .set('Authorization', `Bearer ${coach.token}`)
        .send({ selectedPlayerIds: [notSignedUp.userId] });
      expect(res.status).toBe(422);
    } finally {
      await deleteTestUser(notSignedUp.userId);
    }
  });

  it('PUT selections rejects a fabricated UUID', async () => {
    const res = await request(app)
      .put(`/api/matches/${matchId}/selections`)
      .set('Authorization', `Bearer ${coach.token}`)
      .send({ selectedPlayerIds: ['00000000-0000-0000-0000-000000000000'] });
    expect(res.status).toBe(422);
  });

  it('PUT selections with an empty array clears all selections', async () => {
    const res = await request(app)
      .put(`/api/matches/${matchId}/selections`)
      .set('Authorization', `Bearer ${coach.token}`)
      .send({ selectedPlayerIds: [] });
    expect(res.status).toBe(200);
    expect(res.body.data.selectedCount).toBe(0);
  });

  it('PUT selections on a published match keeps it published (manual swap)', async () => {
    // A second signed-up player to swap in.
    const player2 = await createTestUser('player', '-sel-swap');
    await signupPlayer(matchId, player2.userId);
    try {
      // Start from a published squad containing player1.
      await request(app)
        .put(`/api/matches/${matchId}/selections`)
        .set('Authorization', `Bearer ${coach.token}`)
        .send({ selectedPlayerIds: [player.userId] });
      await supabaseAdmin.from('matches').update({ status: 'published' }).eq('match_id', matchId);

      // Swap player1 out for player2.
      const res = await request(app)
        .put(`/api/matches/${matchId}/selections`)
        .set('Authorization', `Bearer ${coach.token}`)
        .send({ selectedPlayerIds: [player2.userId] });
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('published');

      // Match stays published rather than reverting to 'optimized'.
      const { data: m } = await supabaseAdmin.from('matches').select('status').eq('match_id', matchId).single();
      expect(m!.status).toBe('published');
    } finally {
      // Reset state for later tests and clean up.
      await supabaseAdmin.from('matches').update({ status: 'signup_open' }).eq('match_id', matchId);
      await supabaseAdmin.from('selections').delete().eq('match_id', matchId);
      await supabaseAdmin.from('signups').delete().eq('match_id', matchId).eq('player_id', player2.userId);
      await deleteTestUser(player2.userId);
    }
  });

  it('GET selections surfaces the persisted optimizationResult', async () => {
    // No Julia in tests — write the run summary directly, as the optimizer would.
    const optimizationResult = {
      formation: { GK: { covered: true, required: 1, filled: 1 } },
      deficit: 0, objective: -3.2, fairnessWeight: 0.5,
      selectedCount: 1, solveTimeMs: 12.3, optimizedAt: new Date().toISOString(),
    };
    await supabaseAdmin.from('matches').update({ optimization_result: optimizationResult }).eq('match_id', matchId);

    const res = await request(app)
      .get(`/api/matches/${matchId}/selections`)
      .set('Authorization', `Bearer ${coach.token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.match.optimizationResult).toBeTruthy();
    expect(res.body.data.match.optimizationResult.deficit).toBe(0);
    expect(res.body.data.match.optimizationResult.formation.GK.filled).toBe(1);
  });
});
