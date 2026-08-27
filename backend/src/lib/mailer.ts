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
  const dateStr = new Date(`${match.matchDate}T${match.matchTime}`).toLocaleDateString('da-DK', {
    weekday: 'long', day: 'numeric', month: 'long',
  });
  const timeStr = match.matchTime.slice(0, 5);
  const opponent = match.opponent ? ` vs ${match.opponent}` : '';

  return sendMany(players, 'selection notifications', p => ({
    subject: `Du er udtaget — ${dateStr}`,
    html: `<p>Hej <strong>${p.name}</strong>,</p>
     <p>Du er udtaget til den kommende kamp.</p>
     <table style="border-collapse:collapse;margin:16px 0">
       <tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:14px">Dato</td><td style="font-size:14px;font-weight:600">${dateStr}</td></tr>
       <tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:14px">Tidspunkt</td><td style="font-size:14px">${timeStr}</td></tr>
       <tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:14px">Sted</td><td style="font-size:14px">${match.location}${opponent}</td></tr>
     </table>
     <a href="${FRONTEND_URL}/dashboard" style="display:inline-block;background:#205B3B;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-size:14px;font-weight:600">Se på oversigten →</a>`,
    text: `Hej ${p.name},\n\nDu er udtaget til den kommende kamp.\n\nDato: ${dateStr}\nTidspunkt: ${timeStr}\nSted: ${match.location}${opponent}\n\n${FRONTEND_URL}/dashboard`,
  }));
}

// ─── Removed from squad ───────────────────────────────────────────────────────

// Sent when a coach manually drops a player from an already-published squad.
export async function sendDeselectionNotifications(
  players: { name: string; email: string }[],
  match: { matchDate: string; matchTime: string; location: string; opponent: string | null },
): Promise<SendResult> {
  const dateStr = new Date(`${match.matchDate}T${match.matchTime}`).toLocaleDateString('da-DK', {
    weekday: 'long', day: 'numeric', month: 'long',
  });
  const timeStr = match.matchTime.slice(0, 5);
  const opponent = match.opponent ? ` vs ${match.opponent}` : '';

  return sendMany(players, 'deselection notifications', p => ({
    subject: `Ændring i truppen — ${dateStr}`,
    html: `<p>Hej <strong>${p.name}</strong>,</p>
     <p>Træneren har ændret truppen, og du er ikke længere udtaget til denne kamp.</p>
     <table style="border-collapse:collapse;margin:16px 0">
       <tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:14px">Dato</td><td style="font-size:14px;font-weight:600">${dateStr}</td></tr>
       <tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:14px">Tidspunkt</td><td style="font-size:14px">${timeStr}</td></tr>
       <tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:14px">Sted</td><td style="font-size:14px">${match.location}${opponent}</td></tr>
     </table>`,
    text: `Hej ${p.name},\n\nTræneren har ændret truppen, og du er ikke længere udtaget til denne kamp.\n\nDato: ${dateStr}\nTidspunkt: ${timeStr}\nSted: ${match.location}${opponent}`,
  }));
}

// ─── Match cancellation ───────────────────────────────────────────────────────

export async function sendCancellationNotifications(
  players: { name: string; email: string }[],
  match: { matchDate: string; matchTime: string; location: string; opponent: string | null },
  cancelledBy: 'us' | 'opponent' | null = null,
): Promise<SendResult> {
  const dateStr = new Date(`${match.matchDate}T${match.matchTime}`).toLocaleDateString('da-DK', {
    weekday: 'long', day: 'numeric', month: 'long',
  });
  const timeStr = match.matchTime.slice(0, 5);
  const opponent = match.opponent ? ` vs ${match.opponent}` : '';

  // A side that calls the match off forfeits it, so say how it was scored.
  const outcomeText = cancelledBy === 'opponent'
    ? 'Modstanderen aflyste, så kampen tælles som en 3–0-sejr til os.'
    : cancelledBy === 'us'
      ? 'Vi aflyste, så kampen tælles som et 0–3-nederlag.'
      : '';

  return sendMany(players, 'cancellation notifications', p => ({
    subject: `Kamp aflyst — ${dateStr}`,
    html: `<p>Hej <strong>${p.name}</strong>,</p>
     <p>Desværre er den kamp, du var udtaget til, blevet aflyst.</p>
     ${outcomeText ? `<p>${outcomeText}</p>` : ''}
     <table style="border-collapse:collapse;margin:16px 0">
       <tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:14px">Dato</td><td style="font-size:14px;font-weight:600">${dateStr}</td></tr>
       <tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:14px">Tidspunkt</td><td style="font-size:14px">${timeStr}</td></tr>
       <tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:14px">Sted</td><td style="font-size:14px">${match.location}${opponent}</td></tr>
     </table>`,
    text: `Hej ${p.name},\n\nDesværre er den kamp, du var udtaget til, blevet aflyst.\n${outcomeText ? `${outcomeText}\n` : ''}\nDato: ${dateStr}\nTidspunkt: ${timeStr}\nSted: ${match.location}${opponent}`,
  }));
}

// ─── Spot released ────────────────────────────────────────────────────────────

export async function sendReleaseNotification(
  coaches: { name: string; email: string }[],
  playerName: string,
  match: { matchDate: string; matchTime: string; location: string; opponent: string | null },
  matchId: string,
): Promise<SendResult> {
  const dateStr = new Date(`${match.matchDate}T${match.matchTime}`).toLocaleDateString('da-DK', {
    weekday: 'long', day: 'numeric', month: 'long',
  });
  const timeStr = match.matchTime.slice(0, 5);
  const opponent = match.opponent ? ` vs ${match.opponent}` : '';

  return sendMany(coaches, 'release notifications', c => ({
    subject: `Plads frigivet — ${playerName} · ${dateStr}`,
    html: `<p>Hej <strong>${c.name}</strong>,</p>
     <p><strong>${playerName}</strong> har frigivet sin plads til kampen den ${dateStr}.</p>
     <table style="border-collapse:collapse;margin:16px 0">
       <tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:14px">Dato</td><td style="font-size:14px;font-weight:600">${dateStr}</td></tr>
       <tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:14px">Tidspunkt</td><td style="font-size:14px">${timeStr}</td></tr>
       <tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:14px">Sted</td><td style="font-size:14px">${match.location}${opponent}</td></tr>
     </table>
     <a href="${FRONTEND_URL}/coach/matches/${matchId}/selections" style="display:inline-block;background:#205B3B;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-size:14px;font-weight:600">Administrér trup →</a>`,
    text: `Hej ${c.name},\n\n${playerName} har frigivet sin plads til kampen den ${dateStr}.\n\nDato: ${dateStr}\nTidspunkt: ${timeStr}\nSted: ${match.location}${opponent}\n\n${FRONTEND_URL}/coach/matches/${matchId}/selections`,
  }));
}

// ─── Open spot available ──────────────────────────────────────────────────────

export async function sendSpotOpenNotification(
  players: { name: string; email: string }[],
  match: { matchDate: string; matchTime: string; location: string; opponent: string | null },
): Promise<SendResult> {
  const dateStr = new Date(`${match.matchDate}T${match.matchTime}`).toLocaleDateString('da-DK', {
    weekday: 'long', day: 'numeric', month: 'long',
  });
  const timeStr = match.matchTime.slice(0, 5);
  const opponent = match.opponent ? ` vs ${match.opponent}` : '';

  return sendMany(players, 'spot-open notifications', p => ({
    subject: `En plads er blevet ledig — ${dateStr}`,
    html: `<p>Hej <strong>${p.name}</strong>,</p>
     <p>Der er blevet en plads ledig til kampen den ${dateStr}. Vil du have den? Overtag den, så bekræfter træneren.</p>
     <table style="border-collapse:collapse;margin:16px 0">
       <tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:14px">Dato</td><td style="font-size:14px;font-weight:600">${dateStr}</td></tr>
       <tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:14px">Tidspunkt</td><td style="font-size:14px">${timeStr}</td></tr>
       <tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:14px">Sted</td><td style="font-size:14px">${match.location}${opponent}</td></tr>
     </table>
     <a href="${FRONTEND_URL}/dashboard" style="display:inline-block;background:#205B3B;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-size:14px;font-weight:600">Overtag pladsen →</a>`,
    text: `Hej ${p.name},\n\nDer er blevet en plads ledig til kampen den ${dateStr}. Overtag den, så bekræfter træneren.\n\nDato: ${dateStr}\nTidspunkt: ${timeStr}\nSted: ${match.location}${opponent}\n\n${FRONTEND_URL}/dashboard`,
  }));
}

// ─── Spot claimed (to coaches) ────────────────────────────────────────────────

export async function sendSpotClaimNotification(
  coaches: { name: string; email: string }[],
  claimantName: string,
  match: { matchDate: string; matchTime: string; location: string; opponent: string | null },
  matchId: string,
): Promise<SendResult> {
  const dateStr = new Date(`${match.matchDate}T${match.matchTime}`).toLocaleDateString('da-DK', {
    weekday: 'long', day: 'numeric', month: 'long',
  });
  const timeStr = match.matchTime.slice(0, 5);
  const opponent = match.opponent ? ` vs ${match.opponent}` : '';

  return sendMany(coaches, 'spot-claim notifications', c => ({
    subject: `Plads ønsket — ${claimantName} · ${dateStr}`,
    html: `<p>Hej <strong>${c.name}</strong>,</p>
     <p><strong>${claimantName}</strong> vil gerne overtage en ledig plads til kampen den ${dateStr}. Bekræft vedkommende (eller en anden ansøger) i truppen.</p>
     <table style="border-collapse:collapse;margin:16px 0">
       <tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:14px">Dato</td><td style="font-size:14px;font-weight:600">${dateStr}</td></tr>
       <tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:14px">Tidspunkt</td><td style="font-size:14px">${timeStr}</td></tr>
       <tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:14px">Sted</td><td style="font-size:14px">${match.location}${opponent}</td></tr>
     </table>
     <a href="${FRONTEND_URL}/coach/matches/${matchId}/selections" style="display:inline-block;background:#205B3B;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-size:14px;font-weight:600">Se ansøgerne →</a>`,
    text: `Hej ${c.name},\n\n${claimantName} vil gerne overtage en ledig plads til kampen den ${dateStr}.\n\nDato: ${dateStr}\nTidspunkt: ${timeStr}\nSted: ${match.location}${opponent}\n\n${FRONTEND_URL}/coach/matches/${matchId}/selections`,
  }));
}

// ─── Claim resolved (to claimant) ─────────────────────────────────────────────

export async function sendClaimResolutionNotification(
  claimant: { name: string; email: string },
  accepted: boolean,
  match: { matchDate: string; matchTime: string; location: string; opponent: string | null },
) {
  const dateStr = new Date(`${match.matchDate}T${match.matchTime}`).toLocaleDateString('da-DK', {
    weekday: 'long', day: 'numeric', month: 'long',
  });
  const timeStr = match.matchTime.slice(0, 5);
  const opponent = match.opponent ? ` vs ${match.opponent}` : '';

  await send(
    claimant.email,
    `Plads ${accepted ? 'bekræftet' : 'gik til en anden'} — ${dateStr}`,
    `<p>Hej <strong>${claimant.name}</strong>,</p>
     <p>${accepted
        ? `Du er med i truppen til kampen den ${dateStr}!`
        : `Den ledige plads til kampen den ${dateStr} gik til en anden spiller denne gang.`}</p>
     <table style="border-collapse:collapse;margin:16px 0">
       <tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:14px">Dato</td><td style="font-size:14px;font-weight:600">${dateStr}</td></tr>
       <tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:14px">Tidspunkt</td><td style="font-size:14px">${timeStr}</td></tr>
       <tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:14px">Sted</td><td style="font-size:14px">${match.location}${opponent}</td></tr>
     </table>
     <a href="${FRONTEND_URL}/dashboard" style="display:inline-block;background:#205B3B;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-size:14px;font-weight:600">Se på oversigten →</a>`,
    `Hej ${claimant.name},\n\n${accepted ? `Du er med i truppen til kampen den ${dateStr}!` : `Den ledige plads til kampen den ${dateStr} gik til en anden spiller denne gang.`}\n\nDato: ${dateStr}\nTidspunkt: ${timeStr}\nSted: ${match.location}${opponent}\n\n${FRONTEND_URL}/dashboard`,
  );
}

// ─── Signup deadline reminder ─────────────────────────────────────────────────

export async function sendSignupReminder(
  players: { name: string; email: string }[],
  match: { matchDate: string; matchTime: string; location: string; opponent: string | null; signupCloseDate: string },
): Promise<SendResult> {
  const dateStr = new Date(`${match.matchDate}T${match.matchTime}`).toLocaleDateString('da-DK', {
    weekday: 'long', day: 'numeric', month: 'long',
  });
  const timeStr = match.matchTime.slice(0, 5);
  const opponent = match.opponent ? ` vs ${match.opponent}` : '';
  const deadlineStr = formatClubDeadline(match.signupCloseDate);

  return sendMany(players, 'signup reminders', p => ({
    subject: `Tilmeldingen lukker snart — ${dateStr}`,
    html: `<p>Hej <strong>${p.name}</strong>,</p>
     <p>Tilmeldingen til den kommende kamp lukker <strong>${deadlineStr}</strong>, og du har ikke meldt dig til endnu.</p>
     <table style="border-collapse:collapse;margin:16px 0">
       <tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:14px">Dato</td><td style="font-size:14px;font-weight:600">${dateStr}</td></tr>
       <tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:14px">Tidspunkt</td><td style="font-size:14px">${timeStr}</td></tr>
       <tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:14px">Sted</td><td style="font-size:14px">${match.location}${opponent}</td></tr>
       <tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:14px">Tilmelding lukker</td><td style="font-size:14px">${deadlineStr}</td></tr>
     </table>
     <a href="${FRONTEND_URL}/dashboard" style="display:inline-block;background:#205B3B;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-size:14px;font-weight:600">Tilmeld dig nu →</a>`,
    text: `Hej ${p.name},\n\nTilmeldingen til den kommende kamp lukker ${deadlineStr}, og du har ikke meldt dig til endnu.\n\nDato: ${dateStr}\nTidspunkt: ${timeStr}\nSted: ${match.location}${opponent}\nTilmelding lukker: ${deadlineStr}\n\n${FRONTEND_URL}/dashboard`,
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
    const dateStr = new Date(`${m.matchDate}T${m.matchTime}`).toLocaleDateString('da-DK', {
      weekday: 'long', day: 'numeric', month: 'long',
    });
    const opponent = m.opponent ? ` vs ${m.opponent}` : '';
    const deadline = formatClubDeadline(m.signupCloseDate);
    return {
      label: `${dateStr}${opponent}`,
      html: `<li style="margin:10px 0;font-size:14px">
               <strong>${dateStr}</strong>${opponent}<br>
               <span style="color:#6b7280">${m.matchTime.slice(0, 5)} · ${m.location}</span><br>
               <span style="color:#6b7280">Tilmeld dig senest ${deadline}</span>
             </li>`,
      text: `- ${dateStr}${opponent}\n  ${m.matchTime.slice(0, 5)} · ${m.location}\n  Tilmeld dig senest ${deadline}`,
    };
  });

  const subject = n === 1
    ? `Tilmelding åben — ${rows[0].label}`
    : `Tilmelding åben — ${n} nye kampe`;
  const intro = n === 1
    ? 'Tilmeldingen er åben til en ny kamp:'
    : `Tilmeldingen er åben til ${n} nye kampe:`;

  await send(
    player.email,
    subject,
    `<p>Hej <strong>${player.name}</strong>,</p>
     <p>${intro}</p>
     <ul style="padding-left:18px;margin:12px 0">${rows.map(r => r.html).join('')}</ul>
     <a href="${FRONTEND_URL}/dashboard" style="display:inline-block;background:#205B3B;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-size:14px;font-weight:600">Tilmeld dig nu →</a>`,
    `Hej ${player.name},\n\n${intro}\n${rows.map(r => r.text).join('\n')}\n\n${FRONTEND_URL}/dashboard`,
  );
}

// ─── New registration ─────────────────────────────────────────────────────────

export async function sendAdminRegistrationNotification(playerName: string, playerEmail: string) {
  const adminEmail = process.env.ADMIN_EMAIL || 'andreas@brendstrup.dk';
  await send(
    adminEmail,
    `Ny registrering: ${playerName}`,
    `<p>En ny spiller har registreret sig og afventer godkendelse.</p>
     <table style="border-collapse:collapse;margin:16px 0">
       <tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:14px">Navn</td><td style="font-size:14px;font-weight:600">${playerName}</td></tr>
       <tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:14px">E-mail</td><td style="font-size:14px">${playerEmail}</td></tr>
     </table>
     <a href="${FRONTEND_URL}/admin" style="display:inline-block;background:#205B3B;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-size:14px;font-weight:600">Se i adminpanelet →</a>`,
    `En ny spiller har registreret sig og afventer godkendelse.\n\nNavn: ${playerName}\nE-mail: ${playerEmail}\n\n${FRONTEND_URL}/admin`,
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
    const dateStr = new Date(`${m.matchDate}T${m.matchTime}`).toLocaleDateString('da-DK', {
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
  const dateStr = new Date(`${match.matchDate}T${match.matchTime}`).toLocaleDateString('da-DK', {
    weekday: 'long', day: 'numeric', month: 'long',
  });
  const timeStr = match.matchTime.slice(0, 5);
  const opponent = match.opponent ? ` vs ${match.opponent}` : '';

  return sendMany(players, 'match-day reminders', p => ({
    subject: `Kamp i morgen — ${dateStr}`,
    html: `<p>Hej <strong>${p.name}</strong>,</p>
     <p>Husk: du er i truppen til morgendagens kamp.</p>
     <table style="border-collapse:collapse;margin:16px 0">
       <tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:14px">Dato</td><td style="font-size:14px;font-weight:600">${dateStr}</td></tr>
       <tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:14px">Tidspunkt</td><td style="font-size:14px">${timeStr}</td></tr>
       <tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:14px">Sted</td><td style="font-size:14px">${match.location}${opponent}</td></tr>
     </table>
     <a href="${FRONTEND_URL}/dashboard" style="display:inline-block;background:#205B3B;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-size:14px;font-weight:600">Se på oversigten →</a>`,
    text: `Hej ${p.name},\n\nHusk: du er i truppen til morgendagens kamp.\n\nDato: ${dateStr}\nTidspunkt: ${timeStr}\nSted: ${match.location}${opponent}\n\n${FRONTEND_URL}/dashboard`,
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
    n === 1 ? 'En trup mangler at blive udtaget' : `${n} trupper mangler at blive udtaget`,
    `<p>Hej <strong>${coach.name}</strong>,</p>
     <p>Tilmeldingen er lukket til ${n === 1 ? 'denne kamp' : 'disse kampe'}, og truppen er ikke offentliggjort endnu:</p>
     ${html}
     <a href="${FRONTEND_URL}/coach" style="display:inline-block;background:#205B3B;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-size:14px;font-weight:600">Sammensæt truppen →</a>`,
    `Hej ${coach.name},\n\nTilmeldingen er lukket, og truppen er ikke offentliggjort endnu for:\n${text}\n\n${FRONTEND_URL}/coach`,
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
    n === 1 ? 'Registrér gårsdagens resultat' : `Registrér ${n} kampresultater`,
    `<p>Hej <strong>${recipient.name}</strong>,</p>
     <p>${n === 1 ? 'Denne kamp er' : 'Disse kampe er'} spillet, men resultatet er ikke registreret endnu:</p>
     ${html}
     <a href="${FRONTEND_URL}/coach" style="display:inline-block;background:#205B3B;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-size:14px;font-weight:600">Registrér resultatet →</a>`,
    `Hej ${recipient.name},\n\n${n === 1 ? 'Denne kamp er' : 'Disse kampe er'} spillet, men resultatet er ikke registreret endnu:\n${text}\n\n${FRONTEND_URL}/coach`,
  );
}
