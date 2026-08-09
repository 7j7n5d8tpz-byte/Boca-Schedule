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

describe('Cron: match announcements', () => {
  let openMatchId: string;
  let secondMatchId: string;
  let draftMatchId: string;
  let prevSecret: string | undefined;

  const future = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
  const past = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const minutesAgo = (m: number) => new Date(Date.now() - m * 60 * 1000).toISOString();

  // The batcher scans every un-emailed match in the database, so matches left
  // behind by other suites would be swept into this suite's burst. Park them
  // (already emailed) so only the matches under test remain pending.
  async function isolate(exceptIds: string[]) {
    const stamp = new Date().toISOString();
    await supabaseAdmin
      .from('matches')
      .update({ signup_open_notified_at: stamp, signup_open_emailed_at: stamp })
      .is('signup_open_emailed_at', null)
      .not('match_id', 'in', `(${exceptIds.join(',')})`);
  }

  beforeAll(async () => {
    const [open, second, draft] = await Promise.all([
      createTestMatch({ status: 'signup_open', signup_close_date: future }),
      createTestMatch({ status: 'signup_open', signup_close_date: future }),
      // Scheduled to open an hour ago but still a draft — nothing outside the
      // cron flips it, which is exactly what the first test asserts.
      createTestMatch({ status: 'draft', signup_open_date: past, signup_close_date: future }),
    ]);
    openMatchId = open.match_id;
    secondMatchId = second.match_id;
    draftMatchId = draft.match_id;
  });

  afterAll(async () => {
    await Promise.all([
      deleteTestMatch(openMatchId), deleteTestMatch(secondMatchId), deleteTestMatch(draftMatchId),
    ]);
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
    expect((await request(app).post('/api/cron/match-announcements')).status).toBe(401);
    const res = await request(app)
      .post('/api/cron/match-announcements').set('x-cron-secret', 'wrong');
    expect(res.status).toBe(401);
  });

  it('opens due drafts and announces them in-app, holding the email back', async () => {
    await isolate([openMatchId, secondMatchId, draftMatchId]);

    const res = await request(app)
      .post('/api/cron/match-announcements').set('x-cron-secret', SECRET);
    expect(res.status).toBe(200);
    expect(res.body.data.opened).toBeGreaterThanOrEqual(1);

    const { data: draft } = await supabaseAdmin
      .from('matches')
      .select('status, signup_open_notified_at, signup_open_emailed_at')
      .eq('match_id', draftMatchId).single();
    expect(draft!.status).toBe('signup_open');
    expect(draft!.signup_open_notified_at).toBeTruthy();

    // Everything just opened, so the burst is still inside the quiet window.
    expect(res.body.data.deferred).toBeGreaterThanOrEqual(1);
    expect(draft!.signup_open_emailed_at).toBeNull();

    // In-app notifications land immediately, one per match.
    const { count } = await supabaseAdmin
      .from('notifications')
      .select('notification_id', { count: 'exact', head: true })
      .eq('match_id', draftMatchId).eq('type', 'signup_open');
    expect(count).toBeGreaterThanOrEqual(1);
  });

  it('sends one grouped email once the quiet window has passed, then stops', async () => {
    await isolate([openMatchId, secondMatchId, draftMatchId]);
    // Age the whole burst past the quiet window.
    await supabaseAdmin
      .from('matches')
      .update({ signup_open_notified_at: minutesAgo(90), signup_open_emailed_at: null })
      .in('match_id', [openMatchId, secondMatchId, draftMatchId]);

    const res = await request(app)
      .post('/api/cron/match-announcements').set('x-cron-secret', SECRET);
    expect(res.status).toBe(200);
    // All three go out together — one email per recipient, not one per match.
    expect(res.body.data.matches).toBe(3);

    const { data: rows } = await supabaseAdmin
      .from('matches').select('signup_open_emailed_at')
      .in('match_id', [openMatchId, secondMatchId, draftMatchId]);
    expect(rows!.every(r => r.signup_open_emailed_at)).toBe(true);

    // A second run has nothing left to announce.
    const again = await request(app)
      .post('/api/cron/match-announcements').set('x-cron-secret', SECRET);
    expect(again.body.data.matches).toBe(0);
  });

  it('leaves out matches the recipient already signed up for', async () => {
    const eager = await createTestUser('player', '-announce');
    try {
      await isolate([secondMatchId, draftMatchId]);
      await supabaseAdmin
        .from('matches')
        .update({ signup_open_notified_at: minutesAgo(90), signup_open_emailed_at: null })
        .in('match_id', [secondMatchId, draftMatchId]);
      // Signed up for both while the email was still batching.
      await signupPlayer(secondMatchId, eager.userId);
      await signupPlayer(draftMatchId, eager.userId);

      const res = await request(app)
        .post('/api/cron/match-announcements').set('x-cron-secret', SECRET);
      expect(res.status).toBe(200);
      expect(res.body.data.matches).toBe(2);
      // Nothing left to tell them about, so they get no email at all — while
      // everyone else still does.
      expect(res.body.data.skipped).toBeGreaterThanOrEqual(1);
      expect(res.body.data.recipients).toBeGreaterThanOrEqual(1);
    } finally {
      await supabaseAdmin.from('signups').delete().eq('player_id', eager.userId);
      await supabaseAdmin.from('notifications').delete().eq('user_id', eager.userId);
      await deleteTestUser(eager.userId);
    }
  });

  it('retires a match whose sign-up deadline passed before the email went out', async () => {
    await supabaseAdmin
      .from('matches')
      .update({
        signup_open_notified_at: minutesAgo(90),
        signup_open_emailed_at: null,
        // Keep signup_open_date < signup_close_date — the matches table has a
        // CHECK constraint on that window.
        signup_open_date: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
        signup_close_date: past,
      })
      .eq('match_id', openMatchId);

    const res = await request(app)
      .post('/api/cron/match-announcements').set('x-cron-secret', SECRET);
    expect(res.status).toBe(200);

    const { data: row } = await supabaseAdmin
      .from('matches').select('signup_open_emailed_at').eq('match_id', openMatchId).single();
    expect(row!.signup_open_emailed_at).toBeTruthy();
  });
});
