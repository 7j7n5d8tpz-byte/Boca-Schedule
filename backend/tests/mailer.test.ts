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
  signupCloseDate: '2026-08-09T19:00:00.000Z',
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

  it('states the sign-up deadline in club time, not the server\'s', async () => {
    // signup_close_date is a timestamptz: 19:00 UTC is 21:00 in Copenhagen, and
    // 21:00 is what the app shows. Formatting it without an explicit zone gave
    // whatever Fly was set to (UTC), so every email under-stated the deadline
    // by an hour in winter and two in summer.
    const { sendSignupReminder } = await loadMailer(1000);
    sendMock.mockResolvedValue(ok);

    await sendSignupReminder(players(1), match);

    const { html, text } = sendMock.mock.calls[0][0];
    expect(html).toContain('søn. 9. aug., 21.00');
    expect(text).toContain('Tilmelding lukker: søn. 9. aug., 21.00');
    expect(html).not.toContain('19.00');
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

  it('escapes user-typed text in the HTML body, not in the subject or text', async () => {
    const { sendAdminRegistrationNotification } = await loadMailer(1000);
    sendMock.mockResolvedValue(ok);

    // Anyone can register under any name; it lands in the admin's inbox.
    await sendAdminRegistrationNotification('<a href="https://evil.example">Godkend her</a>', 'x@example.com');

    const sent = sendMock.mock.calls[0][0];
    expect(sent.html).not.toContain('<a href="https://evil.example">');
    expect(sent.html).toContain('&#60;a href=&#34;https://evil.example&#34;&#62;');
    expect(sent.text).toContain('<a href="https://evil.example">Godkend her</a>');
  });

  it('sends the activated player a login link', async () => {
    const { sendAccountActivatedEmail } = await loadMailer(1000);
    sendMock.mockResolvedValue(ok);

    await sendAccountActivatedEmail({ name: 'Jacob Meier', email: 'jacob@example.com' });

    expect(sendMock).toHaveBeenCalledTimes(1);
    const sent = sendMock.mock.calls[0][0];
    expect(sent.to).toBe('jacob@example.com');
    expect(sent.subject).toMatch(/aktiveret/);
    expect(sent.text).toContain('Jacob Meier');
    expect(sent.text).toContain('/login');
  });

  it('lists every short-handed match in one "Vi mangler DIG" email per player', async () => {
    const { sendShortageAlerts } = await loadMailer(1000);
    sendMock.mockResolvedValue(ok);

    const short = [
      { matchDate: '2026-11-21', matchTime: '10:00:00', location: 'Boldbanen', opponent: 'Premier United', missing: 3 },
      { matchDate: '2026-11-28', matchTime: '13:10:00', location: 'Kunstgræs <2>', opponent: null, missing: 1 },
    ];
    const result = await sendShortageAlerts(players(1), () => short);

    expect(result.sent).toBe(1);
    const sent = sendMock.mock.calls[0][0];
    expect(sent.subject).toBe('Vi mangler DIG på banen!');
    expect(sent.subject + sent.text + sent.html).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(sent.text).toContain('Der er huller i startopstillingen. Coach mangler lige præcis DIG!');
    expect(sent.text).toContain('Så find støvlerne frem og hop ind i appen og tilmeld dig:');
    expect(sent.text).toContain('/dashboard');
    expect(sent.text).toContain('Vi mangler spillere til kampene:');
    expect(sent.text).toMatch(/- 3 spillere til .*21\. november kl\. 10:00 vs Premier United · Boldbanen/);
    expect(sent.text).toMatch(/- 1 spiller til .*28\. november kl\. 13:10 · Kunstgræs <2>/);
    expect(sent.html).toContain('Kunstgræs &#60;2&#62;');
    expect(sent.text).not.toMatch(/walkover/i);
  });

  it('says "kampen" when only one match is short', async () => {
    const { sendShortageAlerts } = await loadMailer(1000);
    sendMock.mockResolvedValue(ok);

    await sendShortageAlerts(players(1), () => [
      { matchDate: '2026-11-21', matchTime: '10:00:00', location: 'Boldbanen', opponent: null, missing: 2 },
    ]);
    expect(sendMock.mock.calls[0][0].text).toContain('Vi mangler spillere til kampen:');
  });

  it('adds the shortage line to the deadline reminder when the match is short', async () => {
    const { sendSignupReminder } = await loadMailer(1000);
    sendMock.mockResolvedValue(ok);

    await sendSignupReminder(players(1), { ...match, missing: 2 });
    const short = sendMock.mock.calls[0][0];
    expect(short.subject).toMatch(/^Vi mangler stadig 2 spillere til /);
    expect(short.text).toContain('Vi mangler stadig 2 spillere til kampen, så din tilmelding tæller!');

    sendMock.mockClear();
    await sendSignupReminder(players(1), { ...match, missing: 0 });
    const full = sendMock.mock.calls[0][0];
    expect(full.subject).toMatch(/^Tilmeldingen lukker snart/);
    expect(full.text).not.toContain('Vi mangler');
  });

  it('sends coaches one batched email listing every short match', async () => {
    const { sendCoachShortageAlerts } = await loadMailer(1000);
    sendMock.mockResolvedValue(ok);

    const result = await sendCoachShortageAlerts(players(2), [
      { matchDate: '2026-11-21', matchTime: '10:00:00', location: 'Boldbanen', opponent: 'Premier United', missing: 3 },
      { matchDate: '2026-11-28', matchTime: '13:10:00', location: 'Kunstgræs', opponent: null, missing: 1 },
    ]);
    expect(result.sent).toBe(2);
    const sent = sendMock.mock.calls[0][0];
    expect(sent.subject).toBe('2 kampe mangler spillere');
    expect(sent.text).toMatch(/- 3 spillere til .*21\. november/);
    expect(sent.text).toMatch(/- 1 spiller til .*28\. november/);
    expect(sent.text).toContain('/coach');
  });
});
