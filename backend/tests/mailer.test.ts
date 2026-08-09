import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The Resend SDK is mocked wholesale: these tests are about how mailer.ts reacts
// to what the API returns, not about reaching it.
const sendMock = vi.fn();
vi.mock('resend', () => ({
  Resend: class {
    emails = { send: sendMock };
  },
}));

const match = {
  matchDate: '2026-08-15',
  matchTime: '13:10:00',
  location: 'Boldbanen',
  opponent: 'Premier United',
  signupCloseDate: '2026-08-14T19:00:00.000Z',
};

const players = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ name: `Player ${i}`, email: `p${i}@example.com` }));

// mailer.ts reads the rate limit once at module load, so each test imports a
// fresh copy with the limit it wants (fast, to keep the suite quick).
async function loadMailer(sendsPerSecond: number) {
  vi.resetModules();
  process.env.RESEND_API_KEY = 'test-key';
  process.env.RESEND_SENDS_PER_SECOND = String(sendsPerSecond);
  return import('../src/lib/mailer.js');
}

const ok = { data: { id: 'e1' }, error: null };
const rateLimited = { data: null, error: { name: 'rate_limit_exceeded', message: 'Too many requests' } };

describe('mailer transport', () => {
  beforeEach(() => {
    sendMock.mockReset();
  });

  afterEach(() => {
    process.env.RESEND_API_KEY = '';
    delete process.env.RESEND_SENDS_PER_SECOND;
  });

  it('reports a rejected send as failed instead of silently succeeding', async () => {
    // The bug behind the 2026-08-09 miss: the SDK *resolves* with { error },
    // so an unchecked await counted a 429 as a delivery.
    const { sendSignupReminder } = await loadMailer(1000);
    sendMock.mockResolvedValue({
      data: null,
      error: { name: 'validation_error', message: 'Invalid `to` field' },
    });

    const result = await sendSignupReminder(players(2), match);

    expect(result.sent).toBe(0);
    expect(result.failed).toHaveLength(2);
    expect(result.failed[0].reason).toContain('Invalid `to` field');
  });

  it('retries a rate-limited send and counts it as delivered', async () => {
    const { sendSignupReminder } = await loadMailer(1000);
    sendMock
      .mockResolvedValueOnce(rateLimited)
      .mockResolvedValueOnce(rateLimited)
      .mockResolvedValueOnce(ok);

    const result = await sendSignupReminder(players(1), match);

    expect(sendMock).toHaveBeenCalledTimes(3);
    expect(result).toEqual({ sent: 1, failed: [] });
  });

  it('gives up on a send that stays rate-limited, and keeps the rest', async () => {
    const { sendSignupReminder } = await loadMailer(1000);
    sendMock.mockImplementation(({ to }: { to: string }) =>
      Promise.resolve(to === 'p0@example.com' ? rateLimited : ok));

    const result = await sendSignupReminder(players(3), match);

    expect(result.sent).toBe(2);
    expect(result.failed).toEqual([
      { email: 'p0@example.com', reason: expect.stringContaining('rate_limit_exceeded') },
    ]);
  });

  it('spaces a fan-out out to stay under the provider rate limit', async () => {
    // 20/sec → 50ms apart. Six recipients fired at once must still arrive as six
    // spaced-out calls, not one burst that the API would 429.
    const { sendSignupReminder } = await loadMailer(20);
    const calledAt: number[] = [];
    sendMock.mockImplementation(() => {
      calledAt.push(Date.now());
      return Promise.resolve(ok);
    });

    const result = await sendSignupReminder(players(6), match);

    expect(result).toEqual({ sent: 6, failed: [] });
    expect(calledAt).toHaveLength(6);
    const gaps = calledAt.slice(1).map((t, i) => t - calledAt[i]);
    // A few ms of timer slack, but nowhere near the simultaneous burst that
    // would blow the limit.
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(45);
  });

  it('does not let one failed send poison the ones queued behind it', async () => {
    const { sendSignupReminder } = await loadMailer(20);
    sendMock.mockImplementation(({ to }: { to: string }) =>
      Promise.resolve(to === 'p0@example.com'
        ? { data: null, error: { name: 'validation_error', message: 'nope' } }
        : ok));

    const result = await sendSignupReminder(players(4), match);

    expect(result.sent).toBe(3);
    expect(result.failed).toHaveLength(1);
  });
});
