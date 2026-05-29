import { Resend } from 'resend';
import nodemailer from 'nodemailer';

const FROM = process.env.EMAIL_FROM || '"Boca Boldisch" <no-reply@bocaboldisch.dk>';
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

// ─── Spot released (swap) ─────────────────────────────────────────────────────

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
