import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { createTestUser, deleteTestUser, supabaseAdmin, type TestUser } from './helpers/users.js';
import { createTestMatch, deleteTestMatch, signupPlayer, selectPlayer } from './helpers/data.js';

// Poll for a fire-and-forget side effect (notifications are written async).
async function eventually<T>(fn: () => Promise<T>, predicate: (v: T) => boolean, tries = 20): Promise<T> {
  let last = await fn();
  for (let i = 0; i < tries && !predicate(last); i++) {
    await new Promise(r => setTimeout(r, 50));
    last = await fn();
  }
  return last;
}

describe('Matches', () => {
  let coach: TestUser;
  let player: TestUser;
  const createdMatchIds: string[] = [];

  beforeAll(async () => {
    [coach, player] = await Promise.all([
      createTestUser('coach', '-matches'),
      createTestUser('player', '-matches'),
    ]);
  });

  afterAll(async () => {
    await Promise.all(createdMatchIds.map(deleteTestMatch));
    await Promise.all([deleteTestUser(coach.userId), deleteTestUser(player.userId)]);
  });

  // ── Create ──────────────────────────────────────────────────────────────────

  it('coach creates a match', async () => {
    const res = await request(app)
      .post('/api/matches')
      .set('Authorization', `Bearer ${coach.token}`)
      .send({
        matchDate:       '2030-06-15',
        matchTime:       '18:00',
        location:        'Boca Pitch',
        matchType:       '7-player',
        minPlayers:      5,
        maxPlayers:      7,
        signupOpenDate:  new Date(Date.now() - 86_400_000).toISOString(),
        signupCloseDate: new Date('2030-06-14T18:00:00.000Z').toISOString(),
      });
    expect(res.status).toBe(201);
    expect(res.body.data.matchId).toBeTruthy();
    createdMatchIds.push(res.body.data.matchId);
  });

  it('announces sign-ups in-app when a match is created already open', async () => {
    const res = await request(app)
      .post('/api/matches')
      .set('Authorization', `Bearer ${coach.token}`)
      .send({
        matchDate:       '2030-06-20',
        matchTime:       '19:00',
        location:        'Announce Pitch',
        matchType:       '7-player',
        minPlayers:      5,
        maxPlayers:      7,
        signupOpenDate:  new Date(Date.now() - 86_400_000).toISOString(),
        signupCloseDate: new Date('2030-06-19T18:00:00.000Z').toISOString(),
      });
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('signup_open');
    const mid = res.body.data.matchId;
    createdMatchIds.push(mid);

    // Fire-and-forget: the notification lands just after the response.
    const notes = await eventually(
      async () => (await supabaseAdmin
        .from('notifications').select('user_id, title')
        .eq('match_id', mid).eq('type', 'signup_open')).data ?? [],
      rows => rows.length > 0,
    );
    expect(notes.length).toBeGreaterThan(0);
    expect(notes[0].title).toBe('Tilmeldingen er åben');
    expect(notes.some(n => n.user_id === player.userId)).toBe(true);

    // In-app is stamped; the email is left for the batching cron.
    const { data: row } = await supabaseAdmin
      .from('matches')
      .select('signup_open_notified_at, signup_open_emailed_at')
      .eq('match_id', mid).single();
    expect(row!.signup_open_notified_at).toBeTruthy();
    expect(row!.signup_open_emailed_at).toBeNull();
  });

  it('rejects a match with missing required fields', async () => {
    const res = await request(app)
      .post('/api/matches')
      .set('Authorization', `Bearer ${coach.token}`)
      .send({ matchDate: '2030-06-15' }); // missing location, time, type
    expect(res.status).toBe(422);
  });

  // ── Read ────────────────────────────────────────────────────────────────────

  it('authenticated user gets upcoming matches list', async () => {
    const res = await request(app)
      .get('/api/matches/upcoming')
      .set('Authorization', `Bearer ${player.token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.matches)).toBe(true);
  });

  // ── Update ──────────────────────────────────────────────────────────────────

  it('coach updates a match', async () => {
    const match = await createTestMatch();
    createdMatchIds.push(match.match_id);

    const res = await request(app)
      .put(`/api/matches/${match.match_id}`)
      .set('Authorization', `Bearer ${coach.token}`)
      .send({ location: 'Updated Pitch' });
    expect(res.status).toBe(200);
    expect(res.body.data.location).toBe('Updated Pitch');
  });

  // ── Status lifecycle ────────────────────────────────────────────────────────

  it('status transitions: draft → signup_open → signup_closed → optimized', async () => {
    // Future signupOpenDate makes the match start as draft
    const createRes = await request(app)
      .post('/api/matches')
      .set('Authorization', `Bearer ${coach.token}`)
      .send({
        matchDate:       '2030-07-01',
        matchTime:       '18:00',
        location:        'Lifecycle Pitch',
        matchType:       '7-player',
        minPlayers:      1,
        maxPlayers:      7,
        signupOpenDate:  new Date('2030-06-01T00:00:00.000Z').toISOString(),
        signupCloseDate: new Date('2030-06-30T18:00:00.000Z').toISOString(),
      });
    expect(createRes.status).toBe(201);
    const mid = createRes.body.data.matchId;
    createdMatchIds.push(mid);
    expect(createRes.body.data.status).toBe('draft');

    // draft → signup_open
    const openRes = await request(app)
      .put(`/api/matches/${mid}`)
      .set('Authorization', `Bearer ${coach.token}`)
      .send({ status: 'signup_open' });
    expect(openRes.status).toBe(200);
    expect(openRes.body.data.status).toBe('signup_open');

    // signup_open → signup_closed
    const closedRes = await request(app)
      .put(`/api/matches/${mid}`)
      .set('Authorization', `Bearer ${coach.token}`)
      .send({ status: 'signup_closed' });
    expect(closedRes.status).toBe(200);
    expect(closedRes.body.data.status).toBe('signup_closed');

    // signup_closed → optimized (optimizer has run)
    const optimizedRes = await request(app)
      .put(`/api/matches/${mid}`)
      .set('Authorization', `Bearer ${coach.token}`)
      .send({ status: 'optimized' });
    expect(optimizedRes.status).toBe(200);
    expect(optimizedRes.body.data.status).toBe('optimized');
  });

  // ── Publish ─────────────────────────────────────────────────────────────────

  it('cannot publish when fewer than minPlayers are selected', async () => {
    const match = await createTestMatch({ min_players: 5, max_players: 7 });
    createdMatchIds.push(match.match_id);
    // Sign up and select only 1 player (below minPlayers of 5)
    await signupPlayer(match.match_id, player.userId);
    await selectPlayer(match.match_id, player.userId);

    const res = await request(app)
      .post(`/api/matches/${match.match_id}/publish`)
      .set('Authorization', `Bearer ${coach.token}`);
    expect(res.status).toBe(400);
  });

  // ── Guests ──────────────────────────────────────────────────────────────────

  it('coach can add and delete a guest player', async () => {
    const match = await createTestMatch();
    createdMatchIds.push(match.match_id);

    const add = await request(app)
      .post(`/api/matches/${match.match_id}/guests`)
      .set('Authorization', `Bearer ${coach.token}`)
      .send({ name: 'Guest Player', position: 'STR' });
    expect(add.status).toBe(201);
    expect(add.body.data.guestId).toBeTruthy();

    const del = await request(app)
      .delete(`/api/matches/${match.match_id}/guests/${add.body.data.guestId}`)
      .set('Authorization', `Bearer ${coach.token}`);
    expect(del.status).toBe(200);
  });

  it('rejects a guest with an invalid position', async () => {
    const match = await createTestMatch();
    createdMatchIds.push(match.match_id);

    const res = await request(app)
      .post(`/api/matches/${match.match_id}/guests`)
      .set('Authorization', `Bearer ${coach.token}`)
      .send({ name: 'Ghost', position: 'INVALID' });
    expect(res.status).toBe(422);
  });

  // ── Match-moved notification ──────────────────────────────────────────────────

  it('notifies the squad when a published match is moved', async () => {
    const match = await createTestMatch({ status: 'published' });
    createdMatchIds.push(match.match_id);
    await signupPlayer(match.match_id, player.userId);
    await selectPlayer(match.match_id, player.userId);

    const res = await request(app)
      .put(`/api/matches/${match.match_id}`)
      .set('Authorization', `Bearer ${coach.token}`)
      .send({ matchTime: '20:30' });
    expect(res.status).toBe(200);

    const rows = await eventually(
      () => supabaseAdmin
        .from('notifications')
        .select('type')
        .eq('user_id', player.userId)
        .eq('match_id', match.match_id)
        .eq('type', 'match_moved')
        .then(r => r.data ?? []),
      r => r.length > 0,
    );
    expect(rows.length).toBeGreaterThan(0);
  });

  it('does not notify when a draft match is edited', async () => {
    const match = await createTestMatch({ status: 'draft' });
    createdMatchIds.push(match.match_id);
    await signupPlayer(match.match_id, player.userId);
    await selectPlayer(match.match_id, player.userId);

    await request(app)
      .put(`/api/matches/${match.match_id}`)
      .set('Authorization', `Bearer ${coach.token}`)
      .send({ matchTime: '21:00' });

    // Give any (incorrect) async write a chance to land, then assert none exist.
    await new Promise(r => setTimeout(r, 300));
    const { data } = await supabaseAdmin
      .from('notifications')
      .select('notification_id')
      .eq('user_id', player.userId)
      .eq('match_id', match.match_id)
      .eq('type', 'match_moved');
    expect((data ?? []).length).toBe(0);
  });

  // ── Cancellation walkovers ──────────────────────────────────────────────────

  async function cancel(matchId: string, body: Record<string, unknown>) {
    return request(app)
      .put(`/api/matches/${matchId}`)
      .set('Authorization', `Bearer ${coach.token}`)
      .send(body);
  }

  async function resultOf(matchId: string) {
    const { data } = await supabaseAdmin
      .from('match_results').select('goals_for, goals_against').eq('match_id', matchId).maybeSingle();
    return data;
  }

  it('awards a 3-0 walkover when the opponent cancels', async () => {
    const match = await createTestMatch({ status: 'published' });
    createdMatchIds.push(match.match_id);

    const res = await cancel(match.match_id, { status: 'cancelled', cancelledBy: 'opponent' });
    expect(res.status).toBe(200);

    expect(await resultOf(match.match_id)).toMatchObject({ goals_for: 3, goals_against: 0 });
  });

  it('forfeits 0-3 when we cancel', async () => {
    const match = await createTestMatch({ status: 'published' });
    createdMatchIds.push(match.match_id);

    await cancel(match.match_id, { status: 'cancelled', cancelledBy: 'us' });

    expect(await resultOf(match.match_id)).toMatchObject({ goals_for: 0, goals_against: 3 });
  });

  it('records no result when neither side cancelled', async () => {
    const match = await createTestMatch({ status: 'published' });
    createdMatchIds.push(match.match_id);

    await cancel(match.match_id, { status: 'cancelled', cancelledBy: null });

    expect(await resultOf(match.match_id)).toBeNull();
  });

  it('rewrites the walkover when the outcome is corrected afterwards', async () => {
    const match = await createTestMatch({ status: 'published' });
    createdMatchIds.push(match.match_id);

    await cancel(match.match_id, { status: 'cancelled', cancelledBy: 'us' });
    await cancel(match.match_id, { cancelledBy: 'opponent' });
    expect(await resultOf(match.match_id)).toMatchObject({ goals_for: 3, goals_against: 0 });

    // Clearing the outcome removes the walkover result again.
    await cancel(match.match_id, { cancelledBy: null });
    expect(await resultOf(match.match_id)).toBeNull();
  });

  it('rejects cancelledBy on a match that is not cancelled', async () => {
    const match = await createTestMatch({ status: 'published' });
    createdMatchIds.push(match.match_id);

    const res = await cancel(match.match_id, { cancelledBy: 'opponent' });
    expect(res.status).toBe(422);
    expect(await resultOf(match.match_id)).toBeNull();
  });

  it('un-cancelling clears the walkover result', async () => {
    const match = await createTestMatch({ status: 'published' });
    createdMatchIds.push(match.match_id);

    await cancel(match.match_id, { status: 'cancelled', cancelledBy: 'opponent' });
    await cancel(match.match_id, { status: 'published' });

    expect(await resultOf(match.match_id)).toBeNull();
    const { data } = await supabaseAdmin
      .from('matches').select('cancelled_by').eq('match_id', match.match_id).single();
    expect(data?.cancelled_by).toBeNull();
  });

  // ── Sign-up window vs kick-off ──────────────────────────────────────────────
  //
  // A deadline after kick-off used to be accepted, which let players sign up for
  // a match that had already been played and left the match stuck in
  // `signup_open`, so its result could never be entered.

  it('rejects a new match whose signup deadline is after kick-off', async () => {
    const res = await request(app)
      .post('/api/matches')
      .set('Authorization', `Bearer ${coach.token}`)
      .send({
        matchDate:       '2030-06-15',
        matchTime:       '18:00',
        location:        'Late Deadline Pitch',
        matchType:       '7-player',
        minPlayers:      5,
        maxPlayers:      7,
        signupOpenDate:  new Date(Date.now() - 86_400_000).toISOString(),
        signupCloseDate: new Date('2030-06-16T18:00:00.000Z').toISOString(),
      });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('DEADLINE_AFTER_KICKOFF');
    if (res.body.data?.matchId) createdMatchIds.push(res.body.data.matchId);
  });

  it('rejects moving the deadline past kick-off on an existing match', async () => {
    const match = await createTestMatch({ match_date: '2030-06-15', match_time: '18:00' });
    createdMatchIds.push(match.match_id);

    const res = await request(app)
      .put(`/api/matches/${match.match_id}`)
      .set('Authorization', `Bearer ${coach.token}`)
      .send({ signupCloseDate: new Date('2030-06-16T18:00:00.000Z').toISOString() });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('DEADLINE_AFTER_KICKOFF');

    const { data } = await supabaseAdmin
      .from('matches').select('signup_close_date').eq('match_id', match.match_id).single();
    expect(new Date(data!.signup_close_date).getTime())
      .toBeLessThan(new Date('2030-06-15T16:00:00.000Z').getTime());
  });

  it('rejects moving the match to before its existing deadline', async () => {
    const match = await createTestMatch({
      match_date: '2030-06-15',
      match_time: '18:00',
      signup_close_date: new Date('2030-06-14T18:00:00.000Z').toISOString(),
    });
    createdMatchIds.push(match.match_id);

    const res = await request(app)
      .put(`/api/matches/${match.match_id}`)
      .set('Authorization', `Bearer ${coach.token}`)
      .send({ matchDate: '2030-06-13' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('DEADLINE_AFTER_KICKOFF');
  });

  // The repair migration parks legacy deadlines exactly on kick-off, and the
  // coach form sends that same instant back when the match day is picked, so
  // the boundary has to be accepted rather than rejected.
  it('accepts a deadline landing exactly on kick-off', async () => {
    const res = await request(app)
      .post('/api/matches')
      .set('Authorization', `Bearer ${coach.token}`)
      .send({
        matchDate:       '2030-06-15',
        matchTime:       '18:00',
        location:        'Kickoff Deadline Pitch',
        matchType:       '7-player',
        minPlayers:      5,
        maxPlayers:      7,
        signupOpenDate:  new Date(Date.now() - 86_400_000).toISOString(),
        // 18:00 on 15 June in Copenhagen (CEST) is 16:00 UTC.
        signupCloseDate: new Date('2030-06-15T16:00:00.000Z').toISOString(),
      });
    expect(res.status).toBe(201);
    createdMatchIds.push(res.body.data.matchId);
  });

  it('allows an edit that touches neither end of the window', async () => {
    const match = await createTestMatch({ match_date: '2030-06-15', match_time: '18:00' });
    createdMatchIds.push(match.match_id);

    const res = await request(app)
      .put(`/api/matches/${match.match_id}`)
      .set('Authorization', `Bearer ${coach.token}`)
      .send({ location: 'Window Untouched Pitch' });
    expect(res.status).toBe(200);
  });

  it('auto-completes a played match the coach never published, so the result can be entered', async () => {
    // Deadline in the future but kick-off in the past — the state the old
    // validation allowed. It must still reach the coach's "record results" list.
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const match = await createTestMatch({
      status: 'signup_open',
      match_date: yesterday,
      match_time: '18:00',
      signup_close_date: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    });
    createdMatchIds.push(match.match_id);

    const res = await request(app)
      .get('/api/matches/upcoming?status=all')
      .set('Authorization', `Bearer ${coach.token}`);
    expect(res.status).toBe(200);

    const { data } = await supabaseAdmin
      .from('matches').select('status, completed_at').eq('match_id', match.match_id).single();
    expect(data!.status).toBe('completed');
    expect(data!.completed_at).toBeTruthy();
  });
});
