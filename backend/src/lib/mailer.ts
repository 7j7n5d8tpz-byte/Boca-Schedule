import { Resend } from 'resend';
import nodemailer from 'nodemailer';

const FROM = process.env.EMAIL_FROM || '"Boca Boldisch" <boca_admin@bocaboldisch.dk>';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

// Use Resend in production (RESEND_API_KEY set), fall back to local Mailpit in dev
async function send(to: string, subject: string, html: string, text: string) {
  if (process.env.RESEND_API_KEY) {
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({ from: FROM, to, subject, html, text });
  } else {
    // Local dev: deliver to Mailpit on Supabase's bundled SMTP (port 54325)
    const transporter = nodemailer.createTransport({
      host: '127.0.0.1',
      port: 54325,
      secure: false,
    });
    await transporter.sendMail({ from: FROM, to, subject, html, text });
  }
}

// ─── Match selection ──────────────────────────────────────────────────────────

export async function sendSelectionNotifications(
  players: { name: string; email: string }[],
  match: { matchDate: string; matchTime: string; location: string; opponent: string | null },
) {
  const dateStr = new Date(`${match.matchDate}T${match.matchTime}`).toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long',
  });
  const timeStr = match.matchTime.slice(0, 5);
  const opponent = match.opponent ? ` vs ${match.opponent}` : '';

  await Promise.allSettled(players.map(p => send(
    p.email,
    `You're selected — ${dateStr}`,
    `<p>Hi <strong>${p.name}</strong>,</p>
     <p>You've been selected for the upcoming match.</p>
     <table style="border-collapse:collapse;margin:16px 0">
       <tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:14px">Date</td><td style="font-size:14px;font-weight:600">${dateStr}</td></tr>
       <tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:14px">Time</td><td style="font-size:14px">${timeStr}</td></tr>
       <tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:14px">Location</td><td style="font-size:14px">${match.location}${opponent}</td></tr>
     </table>
     <a href="${FRONTEND_URL}/dashboard" style="display:inline-block;background:#205B3B;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-size:14px;font-weight:600">View on dashboard →</a>`,
    `Hi ${p.name},\n\nYou've been selected for the upcoming match.\n\nDate: ${dateStr}\nTime: ${timeStr}\nLocation: ${match.location}${opponent}\n\n${FRONTEND_URL}/dashboard`,
  )));
}

// ─── Match cancellation ───────────────────────────────────────────────────────

export async function sendCancellationNotifications(
  players: { name: string; email: string }[],
  match: { matchDate: string; matchTime: string; location: string; opponent: string | null },
) {
  const dateStr = new Date(`${match.matchDate}T${match.matchTime}`).toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long',
  });
  const timeStr = match.matchTime.slice(0, 5);
  const opponent = match.opponent ? ` vs ${match.opponent}` : '';

  await Promise.allSettled(players.map(p => send(
    p.email,
    `Match cancelled — ${dateStr}`,
    `<p>Hi <strong>${p.name}</strong>,</p>
     <p>Unfortunately the match you were selected for has been cancelled.</p>
     <table style="border-collapse:collapse;margin:16px 0">
       <tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:14px">Date</td><td style="font-size:14px;font-weight:600">${dateStr}</td></tr>
       <tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:14px">Time</td><td style="font-size:14px">${timeStr}</td></tr>
       <tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:14px">Location</td><td style="font-size:14px">${match.location}${opponent}</td></tr>
     </table>`,
    `Hi ${p.name},\n\nUnfortunately the match you were selected for has been cancelled.\n\nDate: ${dateStr}\nTime: ${timeStr}\nLocation: ${match.location}${opponent}`,
  )));
}

// ─── Spot released ────────────────────────────────────────────────────────────

export async function sendReleaseNotification(
  coaches: { name: string; email: string }[],
  playerName: string,
  match: { matchDate: string; matchTime: string; location: string; opponent: string | null },
  matchId: string,
) {
  const dateStr = new Date(`${match.matchDate}T${match.matchTime}`).toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long',
  });
  const timeStr = match.matchTime.slice(0, 5);
  const opponent = match.opponent ? ` vs ${match.opponent}` : '';

  await Promise.allSettled(coaches.map(c => send(
    c.email,
    `Spot released — ${playerName} · ${dateStr}`,
    `<p>Hi <strong>${c.name}</strong>,</p>
     <p><strong>${playerName}</strong> has released their spot for the match on ${dateStr}.</p>
     <table style="border-collapse:collapse;margin:16px 0">
       <tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:14px">Date</td><td style="font-size:14px;font-weight:600">${dateStr}</td></tr>
       <tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:14px">Time</td><td style="font-size:14px">${timeStr}</td></tr>
       <tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:14px">Location</td><td style="font-size:14px">${match.location}${opponent}</td></tr>
     </table>
     <a href="${FRONTEND_URL}/coach/matches/${matchId}/selections" style="display:inline-block;background:#205B3B;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-size:14px;font-weight:600">Manage squad →</a>`,
    `Hi ${c.name},\n\n${playerName} has released their spot for the match on ${dateStr}.\n\nDate: ${dateStr}\nTime: ${timeStr}\nLocation: ${match.location}${opponent}\n\n${FRONTEND_URL}/coach/matches/${matchId}/selections`,
  )));
}

// ─── Open spot available ──────────────────────────────────────────────────────

export async function sendSpotOpenNotification(
  players: { name: string; email: string }[],
  match: { matchDate: string; matchTime: string; location: string; opponent: string | null },
) {
  const dateStr = new Date(`${match.matchDate}T${match.matchTime}`).toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long',
  });
  const timeStr = match.matchTime.slice(0, 5);
  const opponent = match.opponent ? ` vs ${match.opponent}` : '';

  await Promise.allSettled(players.map(p => send(
    p.email,
    `A spot opened up — ${dateStr}`,
    `<p>Hi <strong>${p.name}</strong>,</p>
     <p>A spot has opened up for the match on ${dateStr}. Want it? Claim it and the coach will confirm.</p>
     <table style="border-collapse:collapse;margin:16px 0">
       <tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:14px">Date</td><td style="font-size:14px;font-weight:600">${dateStr}</td></tr>
       <tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:14px">Time</td><td style="font-size:14px">${timeStr}</td></tr>
       <tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:14px">Location</td><td style="font-size:14px">${match.location}${opponent}</td></tr>
     </table>
     <a href="${FRONTEND_URL}/dashboard" style="display:inline-block;background:#205B3B;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-size:14px;font-weight:600">Claim the spot →</a>`,
    `Hi ${p.name},\n\nA spot has opened up for the match on ${dateStr}. Claim it and the coach will confirm.\n\nDate: ${dateStr}\nTime: ${timeStr}\nLocation: ${match.location}${opponent}\n\n${FRONTEND_URL}/dashboard`,
  )));
}

// ─── Spot claimed (to coaches) ────────────────────────────────────────────────

export async function sendSpotClaimNotification(
  coaches: { name: string; email: string }[],
  claimantName: string,
  match: { matchDate: string; matchTime: string; location: string; opponent: string | null },
  matchId: string,
) {
  const dateStr = new Date(`${match.matchDate}T${match.matchTime}`).toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long',
  });
  const timeStr = match.matchTime.slice(0, 5);
  const opponent = match.opponent ? ` vs ${match.opponent}` : '';

  await Promise.allSettled(coaches.map(c => send(
    c.email,
    `Spot claimed — ${claimantName} · ${dateStr}`,
    `<p>Hi <strong>${c.name}</strong>,</p>
     <p><strong>${claimantName}</strong> wants to take an open spot for the match on ${dateStr}. Confirm them (or another claimant) in the squad.</p>
     <table style="border-collapse:collapse;margin:16px 0">
       <tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:14px">Date</td><td style="font-size:14px;font-weight:600">${dateStr}</td></tr>
       <tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:14px">Time</td><td style="font-size:14px">${timeStr}</td></tr>
       <tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:14px">Location</td><td style="font-size:14px">${match.location}${opponent}</td></tr>
     </table>
     <a href="${FRONTEND_URL}/coach/matches/${matchId}/selections" style="display:inline-block;background:#205B3B;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-size:14px;font-weight:600">Review claimants →</a>`,
    `Hi ${c.name},\n\n${claimantName} wants to take an open spot for the match on ${dateStr}.\n\nDate: ${dateStr}\nTime: ${timeStr}\nLocation: ${match.location}${opponent}\n\n${FRONTEND_URL}/coach/matches/${matchId}/selections`,
  )));
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
) {
  const dateStr = new Date(`${match.matchDate}T${match.matchTime}`).toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long',
  });
  const timeStr = match.matchTime.slice(0, 5);
  const opponent = match.opponent ? ` vs ${match.opponent}` : '';
  const deadlineStr = new Date(match.signupCloseDate).toLocaleString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });

  await Promise.allSettled(players.map(p => send(
    p.email,
    `Signup closing soon — ${dateStr}`,
    `<p>Hi <strong>${p.name}</strong>,</p>
     <p>Signups for the upcoming match close <strong>${deadlineStr}</strong> and you haven't signed up yet.</p>
     <table style="border-collapse:collapse;margin:16px 0">
       <tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:14px">Date</td><td style="font-size:14px;font-weight:600">${dateStr}</td></tr>
       <tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:14px">Time</td><td style="font-size:14px">${timeStr}</td></tr>
       <tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:14px">Location</td><td style="font-size:14px">${match.location}${opponent}</td></tr>
       <tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:14px">Signup closes</td><td style="font-size:14px">${deadlineStr}</td></tr>
     </table>
     <a href="${FRONTEND_URL}/dashboard" style="display:inline-block;background:#205B3B;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-size:14px;font-weight:600">Sign up now →</a>`,
    `Hi ${p.name},\n\nSignups for the upcoming match close ${deadlineStr} and you haven't signed up yet.\n\nDate: ${dateStr}\nTime: ${timeStr}\nLocation: ${match.location}${opponent}\nSignup closes: ${deadlineStr}\n\n${FRONTEND_URL}/dashboard`,
  )));
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
) {
  const dateStr = new Date(`${match.matchDate}T${match.matchTime}`).toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long',
  });
  const timeStr = match.matchTime.slice(0, 5);
  const opponent = match.opponent ? ` vs ${match.opponent}` : '';

  await Promise.allSettled(players.map(p => send(
    p.email,
    `Match tomorrow — ${dateStr}`,
    `<p>Hi <strong>${p.name}</strong>,</p>
     <p>Reminder: you're in the squad for tomorrow's match.</p>
     <table style="border-collapse:collapse;margin:16px 0">
       <tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:14px">Date</td><td style="font-size:14px;font-weight:600">${dateStr}</td></tr>
       <tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:14px">Time</td><td style="font-size:14px">${timeStr}</td></tr>
       <tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:14px">Location</td><td style="font-size:14px">${match.location}${opponent}</td></tr>
     </table>
     <a href="${FRONTEND_URL}/dashboard" style="display:inline-block;background:#205B3B;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-size:14px;font-weight:600">View on dashboard →</a>`,
    `Hi ${p.name},\n\nReminder: you're in the squad for tomorrow's match.\n\nDate: ${dateStr}\nTime: ${timeStr}\nLocation: ${match.location}${opponent}\n\n${FRONTEND_URL}/dashboard`,
  )));
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
