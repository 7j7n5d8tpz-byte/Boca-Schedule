import { describe, it, expect, vi, beforeEach } from 'vitest';

// web-push and the database are mocked: these tests are about what push.ts does
// with the push services' answers, not about reaching them.
const sendNotification = vi.fn();
vi.mock('web-push', () => ({
  default: { setVapidDetails: vi.fn(), sendNotification: (...a: unknown[]) => sendNotification(...a) },
}));

const deleted: string[][] = [];
const touched: string[][] = [];
let rows: { subscription_id: string; endpoint: string; p256dh: string; auth: string }[] = [];
vi.mock('../src/lib/supabase.js', () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({ in: async () => ({ data: rows, error: null }) }),
      delete: () => ({ in: async (_c: string, ids: string[]) => { deleted.push(ids); return { error: null }; } }),
      update: () => ({ in: async (_c: string, ids: string[]) => { touched.push(ids); return { error: null }; } }),
    }),
  },
}));

async function loadPush(keys: boolean) {
  vi.resetModules();
  process.env.VAPID_PUBLIC_KEY = keys ? 'pub' : '';
  process.env.VAPID_PRIVATE_KEY = keys ? 'priv' : '';
  return import('../src/lib/push.js');
}

const sub = (id: string) => ({ subscription_id: id, endpoint: `https://fcm.googleapis.com/fcm/send/${id}`, p256dh: 'k', auth: 'a' });

describe('sendPush', () => {
  beforeEach(() => {
    sendNotification.mockReset();
    deleted.length = 0;
    touched.length = 0;
    rows = [sub('s1'), sub('s2'), sub('s3')];
  });

  it('does nothing without VAPID keys', async () => {
    const { sendPush, pushEnabled } = await loadPush(false);
    expect(pushEnabled()).toBe(false);
    expect(await sendPush(['u1'], { title: 'x' })).toEqual({ sent: 0, removed: 0 });
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('sends to every device and deletes the ones the push service says are gone', async () => {
    const { sendPush } = await loadPush(true);
    sendNotification
      .mockResolvedValueOnce({})                                   // s1 ok
      .mockRejectedValueOnce(Object.assign(new Error('gone'), { statusCode: 410 }))  // s2 gone
      .mockRejectedValueOnce(Object.assign(new Error('busy'), { statusCode: 503 })); // s3 transient

    const result = await sendPush(['u1'], { title: 'Vi mangler DIG på banen!', body: 'b', url: '/dashboard', tag: 't' });

    expect(result).toEqual({ sent: 1, removed: 1 });
    expect(deleted).toEqual([['s2']]);          // a transient failure is kept
    expect(touched).toEqual([['s1']]);
    const payload = JSON.parse(sendNotification.mock.calls[0][1]);
    expect(payload).toEqual({ title: 'Vi mangler DIG på banen!', body: 'b', url: '/dashboard', tag: 't' });
  });

  it('never throws', async () => {
    const { sendPush } = await loadPush(true);
    sendNotification.mockImplementation(() => { throw new Error('boom'); });
    await expect(sendPush(['u1'], { title: 'x' })).resolves.toEqual({ sent: 0, removed: 0 });
  });
});

describe('isPushEndpoint', () => {
  it('accepts the browser push services and nothing else', async () => {
    vi.resetModules();
    const { isPushEndpoint } = await import('../src/routes/push.js');
    expect(isPushEndpoint('https://fcm.googleapis.com/fcm/send/abc')).toBe(true);
    expect(isPushEndpoint('https://web.push.apple.com/QG9x')).toBe(true);
    expect(isPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/x')).toBe(true);
    expect(isPushEndpoint('https://evil.example/fcm.googleapis.com')).toBe(false);
    expect(isPushEndpoint('https://fcm.googleapis.com.evil.example/x')).toBe(false);
    expect(isPushEndpoint('http://fcm.googleapis.com/x')).toBe(false);
    expect(isPushEndpoint('http://169.254.169.254/latest')).toBe(false);
    expect(isPushEndpoint('not a url')).toBe(false);
  });
});
