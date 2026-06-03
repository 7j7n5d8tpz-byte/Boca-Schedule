import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { createTestUser, deleteTestUser, supabaseAdmin, type TestUser } from './helpers/users.js';
import { createNotifications } from '../src/lib/notifications.js';

describe('Notifications', () => {
  let player: TestUser;
  let other: TestUser;

  beforeAll(async () => {
    [player, other] = await Promise.all([
      createTestUser('player', '-notif1'),
      createTestUser('player', '-notif2'),
    ]);
    // Deactivate so the all-active-users announcement broadcast from other
    // suites can't land stray notifications here (auth doesn't check is_active,
    // so these users can still call the API). Keeps counts deterministic.
    await supabaseAdmin.from('users').update({ is_active: false }).in('user_id', [player.userId, other.userId]);
  });

  // Reset to a known state before each test. Announcements notify *all* active
  // users (fire-and-forget), so stray notifications from other suites can land
  // on these users — clearing first keeps the counts deterministic.
  beforeEach(async () => {
    await supabaseAdmin.from('notifications').delete().in('user_id', [player.userId, other.userId]);
    await createNotifications([player.userId], { type: 'selected', title: "You're selected", body: 'Sat 7 Jun', link: '/dashboard' });
    await createNotifications([player.userId], { type: 'announcement', title: '📣 New announcement', body: 'Bring shirts', link: '/dashboard' });
  });

  afterAll(async () => {
    await supabaseAdmin.from('notifications').delete().in('user_id', [player.userId, other.userId]);
    await Promise.all([deleteTestUser(player.userId), deleteTestUser(other.userId)]);
  });

  it('lists the current user notifications with an unread count', async () => {
    const res = await request(app)
      .get('/api/notifications')
      .set('Authorization', `Bearer ${player.token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.notifications.length).toBe(2);
    expect(res.body.data.unreadCount).toBe(2);
  });

  it('does not leak another user notifications', async () => {
    const res = await request(app)
      .get('/api/notifications')
      .set('Authorization', `Bearer ${other.token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.notifications.length).toBe(0);
    expect(res.body.data.unreadCount).toBe(0);
  });

  it('unread-count endpoint matches', async () => {
    const res = await request(app)
      .get('/api/notifications/unread-count')
      .set('Authorization', `Bearer ${player.token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.unreadCount).toBe(2);
  });

  it('marks all read', async () => {
    const res = await request(app)
      .put('/api/notifications/read')
      .set('Authorization', `Bearer ${player.token}`);
    expect(res.status).toBe(200);

    const after = await request(app)
      .get('/api/notifications/unread-count')
      .set('Authorization', `Bearer ${player.token}`);
    expect(after.body.data.unreadCount).toBe(0);
  });

  it('requires authentication', async () => {
    const res = await request(app).get('/api/notifications');
    expect(res.status).toBe(401);
  });
});
