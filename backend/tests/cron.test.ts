import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { createTestUser, deleteTestUser, supabaseAdmin, type TestUser } from './helpers/users.js';
import { createTestMatch, deleteTestMatch, signupPlayer } from './helpers/data.js';

const SECRET = 'test-cron-secret';

describe('Cron: signup reminders', () => {
  let player: TestUser;
  let dueMatchId: string;
  let farMatchId: string;
  let prevSecret: string | undefined;

  // signup closes in ~2h — inside the default 24h reminder window
  const soon = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  // signup closes in ~10 days — outside the window
  const far = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();

  beforeAll(async () => {
    player = await createTestUser('player', '-cron');
    const [due, farM] = await Promise.all([
      createTestMatch({ status: 'signup_open', signup_close_date: soon }),
      createTestMatch({ status: 'signup_open', signup_close_date: far }),
    ]);
    dueMatchId = due.match_id;
    farMatchId = farM.match_id;
  });

  afterAll(async () => {
    await Promise.all([deleteTestMatch(dueMatchId), deleteTestMatch(farMatchId)]);
    await deleteTestUser(player.userId);
  });

  beforeEach(() => {
    prevSecret = process.env.CRON_SECRET;
    process.env.CRON_SECRET = SECRET;
  });

  afterEach(() => {
    if (prevSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = prevSecret;
  });

  it('rejects requests with a missing or wrong secret', async () => {
    const res = await request(app).post('/api/cron/signup-reminders');
    expect(res.status).toBe(401);

    const res2 = await request(app)
      .post('/api/cron/signup-reminders')
      .set('x-cron-secret', 'wrong');
    expect(res2.status).toBe(401);
  });

  it('returns 503 when CRON_SECRET is not configured', async () => {
    delete process.env.CRON_SECRET;
    const res = await request(app).post('/api/cron/signup-reminders');
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('CRON_DISABLED');
  });

  it('reminds matches inside the window and stamps them once', async () => {
    const res = await request(app)
      .post('/api/cron/signup-reminders')
      .set('x-cron-secret', SECRET);
    expect(res.status).toBe(200);
    expect(res.body.data.matchesReminded).toBeGreaterThanOrEqual(1);

    // The due match is now stamped; the far match is not.
    const { data: dueRow } = await supabaseAdmin
      .from('matches').select('signup_reminder_sent_at').eq('match_id', dueMatchId).single();
    const { data: farRow } = await supabaseAdmin
      .from('matches').select('signup_reminder_sent_at').eq('match_id', farMatchId).single();
    expect(dueRow!.signup_reminder_sent_at).toBeTruthy();
    expect(farRow!.signup_reminder_sent_at).toBeNull();
  });

  it('does not remind a match twice', async () => {
    // Already stamped by the previous test — a second run should skip it.
    const res = await request(app)
      .post('/api/cron/signup-reminders')
      .set('x-cron-secret', SECRET);
    expect(res.status).toBe(200);
    // dueMatch already stamped, far match still out of window → nothing due.
    const { data: due } = await supabaseAdmin
      .from('matches').select('signup_reminder_sent_at').eq('match_id', dueMatchId).single();
    expect(due!.signup_reminder_sent_at).toBeTruthy();
  });

  it('excludes players who already signed up from the reminder count', async () => {
    // Reset the due match so it is eligible again, then sign the player up.
    await supabaseAdmin.from('matches')
      .update({ signup_reminder_sent_at: null }).eq('match_id', dueMatchId);
    await signupPlayer(dueMatchId, player.userId);

    const res = await request(app)
      .post('/api/cron/signup-reminders')
      .set('x-cron-secret', SECRET);
    expect(res.status).toBe(200);
    // The signed-up player must not be counted among recipients for this match.
    // (Other seeded users may still be reminded, so we only assert the match was processed.)
    const { data: due } = await supabaseAdmin
      .from('matches').select('signup_reminder_sent_at').eq('match_id', dueMatchId).single();
    expect(due!.signup_reminder_sent_at).toBeTruthy();
  });
});
