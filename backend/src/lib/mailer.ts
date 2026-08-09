import { Resend } from 'resend';
import nodemailer from 'nodemailer';
import { formatClubDeadline } from './clubTime.js';

const FROM = process.env.EMAIL_FROM || '"Boca Boldisch" <boca_admin@bocaboldisch.dk>';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

// Resend rate-limits its API (2 requests/second on the default plan). Fanning a
// club-wide email out in parallel blows straight through that and the overflow
// comes back as 429 — on 2026-08-09 seven of the nineteen signup reminders for
// the 15 Aug match were lost exactly that way. So every Resend call queues
// through one process-wide chain that spaces the requests out.
const SENDS_PER_SECOND = Number(process.env.RESEND_SENDS_PER_SECOND) || 2;
const MIN_GAP_MS = Math.ceil(1000 / SENDS_PER_SECOND);
const MAX_ATTEMPTS = 4;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

let queue: Promise<unknown> = Promise.resolve();
let lastCallAt = 0;

function throttled<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const wait = lastCallAt + MIN_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastCallAt = Date.now();
    return task();
  });
  // The copy the next send chains off must never carry a rejection, or one bad
  // address would fail every email queued behind it.
  queue = run.catch(() => {});
  return run;
}

let client: Resend | null = null;
const resendClient = () => (client ??= new Resend(process.env.RESEND_API_KEY!));

// Resend's SDK resolves with `{ data, error }` instead of rejecting, so an
// unchecked `await resend.emails.send(...)` looks successful whatever came back.
// Inspect the error, retry what's worth retrying, throw the rest.
const RETRYABLE = new Set(['rate_limit_exceeded', 'internal_server_error', 'application_error']);

async function sendViaResend(to: string, subject: string, html: string, text: string) {
  for (let attempt = 1; ; attempt++) {
    const { error } = await throttled(() =>
      resendClient().emails.send({ from: FROM, to, subject, html, text }));
    if (!error) return;
    if (attempt >= MAX_ATTEMPTS || !RETRYABLE.has(error.name)) {
      throw new Error(`Resend rejected the email to ${to}: ${error.name} — ${error.message}`);
    }
    await sleep(MIN_GAP_MS * 2 ** attempt);
  }
}

// Use Resend in production (RESEND_API_KEY set), fall back to local Mailpit in dev
async function send(to: string, subject: string, html: string, text: string) {
  if (process.env.RESEND_API_KEY) {
    await sendViaResend(to, subject, html, text);
  } else {
    // Local dev: deliver to Mailpit on Supabase's bundled SMTP (port 54325).
    // No throttle here — Mailpit has no rate limit and the gap would just make
    // the local suite crawl.
    const transporter = nodemailer.createTransport({
      host: '127.0.0.1',
      port: 54325,
      secure: false,
    });
    await transporter.sendMail({ from: FROM, to, subject, html, text });
  }
}

// What a fan-out actually delivered. Callers that stamp "already notified" state
// need this: stamping a run in which every send failed would drop the whole club
// from that notification with nothing to show for it.
export interface SendResult {
  sent: number;
  failed: { email: string; reason: string }[];
}

type Recipient = { name: string; email: string };

// Fan one templated email out to many recipients. The throttle above serialises
// the API calls, so this stays inside the rate limit however long the list is.
async function sendMany(
  recipients: Recipient[],
  label: string,
  build: (r: Recipient) => { subject: string; html: string; text: string },
): Promise<SendResult> {
  const settled = await Promise.allSettled(recipients.map(r => {
    const { subject, html, text } = build(r);
    return send(r.email, subject, html, text);
  }));

  const failed = settled.flatMap((outcome, i) => outcome.status === 'rejected'
    ? [{
        email: recipients[i].email,
        reason: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason),
      }]
    : []);

  if (failed.length > 0) {
    console.error(`${label}: ${failed.length}/${recipients.length} email(s) failed`, failed);
  }
  return { sent: recipients.length - failed.length, failed };
}

// ─── Match selection ──────────────────────────────────────────────────────────

export async function sendSelectionNotifications(
  players: { name: string; email: string }[],
  match: { matchDate: string; matchTime: string; location: string; opponent: string | null },
): Promise<SendResult> {
  const dateStr = new Date(`${match.matchDate}T${match.matchTime}`).toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long',
  });
  const timeStr = match.matchTime.slice(0, 5);
  const opponent = match.opponent ? ` vs ${match.opponent}` : '';

  return sendMany(players, 'selection notifications', p => ({
    subject: `You're selected — ${dateStr}`,
    html: `<p>Hi <strong>${p.name}</strong>,</p>
     <p>You've been selected for the upcoming match.</p>
     <table style="border-collapse:collapse;margin:16px 0">
       <tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:14px">Date</td><td style="font-size:14px;font-weight:600">${dateStr}</td></tr>
       <tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:14px">Time</td><td style="font-size:14px">${timeStr}</td></tr>
       <tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:14px">Location</td><td style="font-size:14px">${match.location}${opponent}</td></tr>
     </table>
     <a href="${FRONTEND_URL}/dashboard" style="display:inline-block;background:#205B3B;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-size:14px;font-weight:600">View on dashboard →</a>`,
    text: `Hi ${p.name},\n\nYou've been selected for the upcoming match.\n\nDate: ${dateStr}\nTime: ${timeStr}\nLocation: ${match.location}${opponent}\n\n${FRONTEND_URL}/dashboard`,
  }));
}

// ─── Removed from squad ───────────────────────────────────────────────────────

// Sent when a coach manually drops a player from an already-published squad.
export async function sendDeselectionNotifications(
  players: { name: string; email: string }[],
  match: { matchDate: string; matchTime: string; location: string; opponent: string | null },
): Promise<SendResult> {
  const dateStr = new Date(`${match.matchDate}T${match.matchTime}`).toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long',
  });
  const timeStr = match.matchTime.slice(0, 5);
  const opponent = match.opponent ? ` vs ${match.opponent}` : '';

  return sendMany(players, 'deselection notifications', p => ({
    subject: `Squad change — ${dateStr}`,
    html: `<p>Hi <strong>${p.name}</strong>,</p>
     <p>The coach has updated the squad and you're no longer selected for this match.</p>
     <table style="border-collapse:collapse;margin:16px 0">
       <tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:14px">Date</td><td style="font-size:14px;font-weight:600">${dateStr}</td></tr>
       <tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:14px">Time</td><td style="font-size:14px">${timeStr}</td></tr>
       <tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:14px">Location</td><td style="font-size:14px">${match.location}${opponent}</td></tr>
     </table>`,
    text: `Hi ${p.name},\n\nThe coach has updated the squad and you're no longer selected for this match.\n\nDate: ${dateStr}\nTime: ${timeStr}\nLocation: ${match.location}${opponent}`,
  }));
}

// ─── Match cancellation ───────────────────────────────────────────────────────

export async function sendCancellationNotifications(
  players: { name: string; email: string }[],
  match: { matchDate: string; matchTime: string; location: string; opponent: string | null },
): Promise<SendResult> {
  const dateStr = new Date(`${match.matchDate}T${match.matchTime}`).toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long',
  });
  const timeStr = match.matchTime.slice(0, 5);
  const opponent = match.opponent ? ` vs ${match.opponent}` : '';

  return sendMany(players, 'cancellation notifications', p => ({
    subject: `Match cancelled — ${dateStr}`,
    html: `<p>Hi <strong>${p.name}</strong>,</p>
     <p>Unfortunately the match you were selected for has been cancelled.</p>
     <table style="border-collapse:collapse;margin:16px 0">
       <tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:14px">Date</td><td style="font-size:14px;font-weight:600">${dateStr}</td></tr>
       <tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:14px">Time</td><td style="font-size:14px">${timeStr}</td></tr>
       <tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:14px">Location</td><td style="font-size:14px">${match.location}${opponent}</td></tr>
     </table>`,
    text: `Hi ${p.name},\n\nUnfortunately the match you were selected for has been cancelled.\n\nDate: ${dateStr}\nTime: ${timeStr}\nLocation: ${match.location}${opponent}`,
  }));
}

// ─── Spot released ────────────────────────────────────────────────────────────

export async function sendReleaseNotification(
  coaches: { name: string; email: string }[],
  playerName: string,
  match: { matchDate: string; matchTime: string; location: string; opponent: string | null },
  matchId: string,
): Promise<SendResult> {
  const dateStr = new Date(`${match.matchDate}T${match.matchTime}`).toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long',
  });
  const timeStr = match.matchTime.slice(0, 5);
  const opponent = match.opponent ? ` vs ${match.opponent}` : '';

  return sendMany(coaches, 'release notifications', c => ({
    subject: `Spot released — ${playerName} · ${dateStr}`,
    html: `<p>Hi <strong>${c.name}</strong>,</p>
     <p><strong>${playerName}</strong> has released their spot for the match on ${dateStr}.</p>
     <table style="border-collapse:collapse;margin:16px 0">
       <tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:14px">Date</td><td style="font-size:14px;font-weight:600">${dateStr}</td></tr>
       <tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:14px">Time</td><td style="font-size:14px">${timeStr}</td></tr>
       <tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:14px">Location</td><td style="font-size:14px">${match.location}${opponent}</td></tr>
     </table>
     <a href="${FRONTEND_URL}/coach/matches/${matchId}/selections" style="display:inline-block;background:#205B3B;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-size:14px;font-weight:600">Manage squad →</a>`,
    text: `Hi ${c.name},\n\n${playerName} has released their spot for the match on ${dateStr}.\n\nDate: ${dateStr}\nTime: ${timeStr}\nLocation: ${match.location}${opponent}\n\n${FRONTEND_URL}/coach/matches/${matchId}/selections`,
  }));
}

// ─── Open spot available ──────────────────────────────────────────────────────

export async function sendSpotOpenNotification(
  players: { name: string; email: string }[],
  match: { matchDate: string; matchTime: string; location: string; opponent: string | null },
): Promise<SendResult> {
  const dateStr = new Date(`${match.matchDate}T${match.matchTime}`).toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long',
  });
  const timeStr = match.matchTime.slice(0, 5);
  const opponent = match.opponent ? ` vs ${match.opponent}` : '';

  return sendMany(players, 'spot-open notifications', p => ({
    subject: `A spot opened up — ${dateStr}`,
    html: `<p>Hi <strong>${p.name}</strong>,</p>
     <p>A spot has opened up for the match on ${dateStr}. Want it? Claim it and the coach will confirm.</p>
     <table style="border-collapse:collapse;margin:16px 0">
       <tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:14px">Date</td><td style="font-size:14px;font-weight:600">${dateStr}</td></tr>
       <tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:14px">Time</td><td style="font-size:14px">${timeStr}</td></tr>
       <tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:14px">Location</td><td style="font-size:14px">${match.location}${opponent}</td></tr>
     </table>
     <a href="${FRONTEND_URL}/dashboard" style="display:inline-block;background:#205B3B;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-size:14px;font-weight:600">Claim the spot →</a>`,
    text: `Hi ${p.name},\n\nA spot has opened up for the match on ${dateStr}. Claim it and the coach will confirm.\n\nDate: ${dateStr}\nTime: ${timeStr}\nLocation: ${match.location}${opponent}\n\n${FRONTEND_URL}/dashboard`,
  }));
}

// ─── Spot claimed (to coaches) ────────────────────────────────────────────────

export async function sendSpotClaimNotification(
  coaches: { name: string; email: string }[],
  claimantName: string,
  match: { matchDate: string; matchTime: string; location: string; opponent: string | null },
  matchId: string,
): Promise<SendResult> {
  const dateStr = new Date(`${match.matchDate}T${match.matchTime}`).toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long',
  });
  const timeStr = match.matchTime.slice(0, 5);
  const opponent = match.opponent ? ` vs ${match.opponent}` : '';

  return sendMany(coaches, 'spot-claim notifications', c => ({
    subject: `Spot claimed — ${claimantName} · ${dateStr}`,
    html: `<p>Hi <strong>${c.name}</strong>,</p>
     <p><strong>${claimantName}</strong> wants to take an open spot for the match on ${dateStr}. Confirm them (or another claimant) in the squad.</p>
     <table style="border-collapse:collapse;margin:16px 0">
       <tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:14px">Date</td><td style="font-size:14px;font-weight:600">${dateStr}</td></tr>
       <tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:14px">Time</td><td style="font-size:14px">${timeStr}</td></tr>
       <tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:14px">Location</td><td style="font-size:14px">${match.location}${opponent}</td></tr>
     </table>
     <a href="${FRONTEND_URL}/coach/matches/${matchId}/selections" style="display:inline-block;background:#205B3B;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-size:14px;font-weight:600">Review claimants →</a>`,
    text: `Hi ${c.name},\n\n${claimantName} wants to take an open spot for the match on ${dateStr}.\n\nDate: ${dateStr}\nTime: ${timeStr}\nLocation: ${match.location}${opponent}\n\n${FRONTEND_URL}/coach/matches/${matchId}/selections`,
  }));
}

// ─── Claim resolved (to claimant) ─────────────────────────────────────────────

export async function sendClaimResolutionNotification(
  claimant: { name: string; email: string },
  accepted: boolean,
  match: { matchDate: string; matchTime: string; location: string; opponent: string | null },
) {
  const dateStr = new Date(`${match.matchDate}T${match.matchTime}`).toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long',
  });
  const timeStr = match.matchTime.slice(0, 5);
  const opponent = match.opponent ? ` vs ${match.opponent}` : '';

  await send(
    claimant.email,
    `Spot claim ${accepted ? 'confirmed' : 'not selected'} — ${dateStr}`,
    `<p>Hi <strong>${claimant.name}</strong>,</p>
     <p>${accepted
        ? `You're in the squad for the match on ${dateStr}!`
        : `The open spot for the match on ${dateStr} went to another player this time.`}</p>
     <table style="border-collapse:collapse;margin:16px 0">
       <tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:14px">Date</td><td style="font-size:14px;font-weight:600">${dateStr}</td></tr>
       <tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:14px">Time</td><td style="font-size:14px">${timeStr}</td></tr>
       <tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:14px">Location</td><td style="font-size:14px">${match.location}${opponent}</td></tr>
     </table>
     <a href="${FRONTEND_URL}/dashboard" style="display:inline-block;background:#205B3B;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-size:14px;font-weight:600">View on dashboard →</a>`,
    `Hi ${claimant.name},\n\n${accepted ? `You're in the squad for the match on ${dateStr}!` : `The open spot for the match on ${dateStr} went to another player this time.`}\n\nDate: ${dateStr}\nTime: ${timeStr}\nLocation: ${match.location}${opponent}\n\n${FRONTEND_URL}/dashboard`,
  );
}

// ─── Signup deadline reminder ─────────────────────────────────────────────────

export async function sendSignupReminder(
  players: { name: string; email: string }[],
  match: { matchDate: string; matchTime: string; location: string; opponent: string | null; signupCloseDate: string },
): Promise<SendResult> {
  const dateStr = new Date(`${match.matchDate}T${match.matchTime}`).toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long',
  });
  const timeStr = match.matchTime.slice(0, 5);
  const opponent = match.opponent ? ` vs ${match.opponent}` : '';
  const deadlineStr = formatClubDeadline(match.signupCloseDate);

  return sendMany(players, 'signup reminders', p => ({
    subject: `Signup closing soon — ${dateStr}`,
    html: `<p>Hi <strong>${p.name}</strong>,</p>
     <p>Signups for the upcoming match close <strong>${deadlineStr}</strong> and you haven't signed up yet.</p>
     <table style="border-collapse:collapse;margin:16px 0">
       <tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:14px">Date</td><td style="font-size:14px;font-weight:600">${dateStr}</td></tr>
       <tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:14px">Time</td><td style="font-size:14px">${timeStr}</td></tr>
       <tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:14px">Location</td><td style="font-size:14px">${match.location}${opponent}</td></tr>
       <tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:14px">Signup closes</td><td style="font-size:14px">${deadlineStr}</td></tr>
     </table>
     <a href="${FRONTEND_URL}/dashboard" style="display:inline-block;background:#205B3B;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-size:14px;font-weight:600">Sign up now →</a>`,
    text: `Hi ${p.name},\n\nSignups for the upcoming match close ${deadlineStr} and you haven't signed up yet.\n\nDate: ${dateStr}\nTime: ${timeStr}\nLocation: ${match.location}${opponent}\nSignup closes: ${deadlineStr}\n\n${FRONTEND_URL}/dashboard`,
  }));
}

// ─── Sign-ups open ────────────────────────────────────────────────────────────

// Sent to every active player when new matches open for sign-up. Batched by
// /api/cron/match-announcements across every match that opened in the same
// burst, so a coach entering the season's next block sends one email, not one
// per match.
export async function sendSignupOpenAnnouncement(
  player: { name: string; email: string },
  matches: { matchDate: string; matchTime: string; location: string; opponent: string | null; signupCloseDate: string }[],
) {
  const n = matches.length;
  const rows = matches.map(m => {
    const dateStr = new Date(`${m.matchDate}T${m.matchTime}`).toLocaleDateString('en-GB', {
      weekday: 'long', day: 'numeric', month: 'long',
    });
    const opponent = m.opponent ? ` vs ${m.opponent}` : '';
    const deadline = formatClubDeadline(m.signupCloseDate);
    return {
      label: `${dateStr}${opponent}`,
      html: `<li style="margin:10px 0;font-size:14px">
               <strong>${dateStr}</strong>${opponent}<br>
               <span style="color:#6b7280">${m.matchTime.slice(0, 5)} · ${m.location}</span><br>
               <span style="color:#6b7280">Sign up by ${deadline}</span>
             </li>`,
      text: `- ${dateStr}${opponent}\n  ${m.matchTime.slice(0, 5)} · ${m.location}\n  Sign up by ${deadline}`,
    };
  });

  const subject = n === 1
    ? `Sign-ups open — ${rows[0].label}`
    : `Sign-ups open — ${n} new matches`;
  const intro = n === 1
    ? 'Sign-ups are open for a new match:'
    : `Sign-ups are open for ${n} new matches:`;

  await send(
    player.email,
    subject,
    `<p>Hi <strong>${player.name}</strong>,</p>
     <p>${intro}</p>
     <ul style="padding-left:18px;margin:12px 0">${rows.map(r => r.html).join('')}</ul>
     <a href="${FRONTEND_URL}/dashboard" style="display:inline-block;background:#205B3B;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-size:14px;font-weight:600">Sign up now →</a>`,
    `Hi ${player.name},\n\n${intro}\n${rows.map(r => r.text).join('\n')}\n\n${FRONTEND_URL}/dashboard`,
  );
}

// ─── New registration ─────────────────────────────────────────────────────────

export async function sendAdminRegistrationNotification(playerName: string, playerEmail: string) {
  const adminEmail = process.env.ADMIN_EMAIL || 'andreas@brendstrup.dk';
  await send(
    adminEmail,
    `New registration: ${playerName}`,
    `<p>A new player has registered and is waiting for approval.</p>
     <table style="border-collapse:collapse;margin:16px 0">
       <tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:14px">Name</td><td style="font-size:14px;font-weight:600">${playerName}</td></tr>
       <tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:14px">Email</td><td style="font-size:14px">${playerEmail}</td></tr>
     </table>
     <a href="${FRONTEND_URL}/admin" style="display:inline-block;background:#205B3B;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-size:14px;font-weight:600">Review in admin panel →</a>`,
    `A new player has registered and is waiting for approval.\n\nName: ${playerName}\nEmail: ${playerEmail}\n\n${FRONTEND_URL}/admin`,
  );
}

// ─── Daily reminders (sent at 18:00 Europe/Copenhagen by the cron) ──────────────

interface ReminderMatch {
  matchDate: string;
  matchTime: string;
  location: string;
  opponent: string | null;
}

function matchLines(matches: ReminderMatch[]): { html: string; text: string } {
  const rows = matches.map(m => {
    const dateStr = new Date(`${m.matchDate}T${m.matchTime}`).toLocaleDateString('en-GB', {
      weekday: 'short', day: 'numeric', month: 'short',
    });
    const opponent = m.opponent ? ` vs ${m.opponent}` : '';
    return {
      html: `<li style="margin:4px 0;font-size:14px"><strong>${dateStr}</strong> · ${m.matchTime.slice(0, 5)} · ${m.location}${opponent}</li>`,
      text: `- ${dateStr} · ${m.matchTime.slice(0, 5)} · ${m.location}${opponent}`,
    };
  });
  return {
    html: `<ul style="padding-left:18px;margin:12px 0">${rows.map(r => r.html).join('')}</ul>`,
    text: rows.map(r => r.text).join('\n'),
  };
}

// Match-day reminder to the selected players, the evening before kick-off.
export async function sendMatchdayReminder(
  players: { name: string; email: string }[],
  match: ReminderMatch,
): Promise<SendResult> {
  const dateStr = new Date(`${match.matchDate}T${match.matchTime}`).toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long',
  });
  const timeStr = match.matchTime.slice(0, 5);
  const opponent = match.opponent ? ` vs ${match.opponent}` : '';

  return sendMany(players, 'match-day reminders', p => ({
    subject: `Match tomorrow — ${dateStr}`,
    html: `<p>Hi <strong>${p.name}</strong>,</p>
     <p>Reminder: you're in the squad for tomorrow's match.</p>
     <table style="border-collapse:collapse;margin:16px 0">
       <tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:14px">Date</td><td style="font-size:14px;font-weight:600">${dateStr}</td></tr>
       <tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:14px">Time</td><td style="font-size:14px">${timeStr}</td></tr>
       <tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:14px">Location</td><td style="font-size:14px">${match.location}${opponent}</td></tr>
     </table>
     <a href="${FRONTEND_URL}/dashboard" style="display:inline-block;background:#205B3B;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-size:14px;font-weight:600">View on dashboard →</a>`,
    text: `Hi ${p.name},\n\nReminder: you're in the squad for tomorrow's match.\n\nDate: ${dateStr}\nTime: ${timeStr}\nLocation: ${match.location}${opponent}\n\n${FRONTEND_URL}/dashboard`,
  }));
}

// Pick-your-squad reminder to one coach — batched across every match whose
// sign-up has closed but whose squad isn't published yet (so the coach gets a
// single email even when several deadlines fall on the same day).
export async function sendSelectionReminder(
  coach: { name: string; email: string },
  matches: ReminderMatch[],
) {
  const n = matches.length;
  const { html, text } = matchLines(matches);
  await send(
    coach.email,
    n === 1 ? 'A squad still needs picking' : `${n} squads still need picking`,
    `<p>Hi <strong>${coach.name}</strong>,</p>
     <p>Sign-ups have closed for ${n === 1 ? 'this match' : 'these matches'} and the squad isn't published yet:</p>
     ${html}
     <a href="${FRONTEND_URL}/coach" style="display:inline-block;background:#205B3B;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-size:14px;font-weight:600">Pick the squad →</a>`,
    `Hi ${coach.name},\n\nSign-ups have closed and the squad isn't published yet for:\n${text}\n\n${FRONTEND_URL}/coach`,
  );
}

// Record-the-result reminder to one result-enterer — batched across every
// played-but-unrecorded match, so no email-per-match spam.
export async function sendResultReminder(
  recipient: { name: string; email: string },
  matches: ReminderMatch[],
) {
  const n = matches.length;
  const { html, text } = matchLines(matches);
  await send(
    recipient.email,
    n === 1 ? "Record yesterday's result" : `Record ${n} match results`,
    `<p>Hi <strong>${recipient.name}</strong>,</p>
     <p>${n === 1 ? 'This match has' : 'These matches have'} been played but the result isn't recorded yet:</p>
     ${html}
     <a href="${FRONTEND_URL}/coach" style="display:inline-block;background:#205B3B;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-size:14px;font-weight:600">Record the result →</a>`,
    `Hi ${recipient.name},\n\n${n === 1 ? 'This match has' : 'These matches have'} been played but the result isn't recorded yet:\n${text}\n\n${FRONTEND_URL}/coach`,
  );
}
