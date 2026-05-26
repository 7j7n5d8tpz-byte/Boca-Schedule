import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || '127.0.0.1',
  port: Number(process.env.SMTP_PORT || 54325),
  secure: false,
  auth: process.env.SMTP_USER
    ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    : undefined,
});

export async function sendSelectionNotifications(players: { name: string; email: string }[], match: {
  matchDate: string; matchTime: string; location: string; opponent: string | null;
}) {
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  const dateStr = new Date(`${match.matchDate}T${match.matchTime}`).toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long',
  });
  const timeStr = match.matchTime.slice(0, 5);
  const opponent = match.opponent ? ` vs ${match.opponent}` : '';

  await Promise.allSettled(players.map(p =>
    transporter.sendMail({
      from: `"Boca Schedule" <no-reply@bocaschedule.com>`,
      to: p.email,
      subject: `You're selected — ${dateStr}`,
      text: [
        `Hi ${p.name},`,
        ``,
        `You've been selected for the upcoming match.`,
        ``,
        `Date:     ${dateStr}`,
        `Time:     ${timeStr}`,
        `Location: ${match.location}${opponent}`,
        ``,
        `See the full squad on your dashboard:`,
        `${frontendUrl}/dashboard`,
      ].join('\n'),
      html: `
        <p>Hi <strong>${p.name}</strong>,</p>
        <p>You've been selected for the upcoming match.</p>
        <table style="border-collapse:collapse;margin:16px 0">
          <tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:14px">Date</td><td style="font-size:14px;font-weight:600">${dateStr}</td></tr>
          <tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:14px">Time</td><td style="font-size:14px">${timeStr}</td></tr>
          <tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:14px">Location</td><td style="font-size:14px">${match.location}${opponent}</td></tr>
        </table>
        <a href="${frontendUrl}/dashboard" style="display:inline-block;background:#16a34a;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-size:14px;font-weight:600">
          View on dashboard →
        </a>
      `,
    })
  ));
}

export async function sendCancellationNotifications(players: { name: string; email: string }[], match: {
  matchDate: string; matchTime: string; location: string; opponent: string | null;
}) {
  const dateStr = new Date(`${match.matchDate}T${match.matchTime}`).toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long',
  });
  const timeStr = match.matchTime.slice(0, 5);
  const opponent = match.opponent ? ` vs ${match.opponent}` : '';

  await Promise.allSettled(players.map(p =>
    transporter.sendMail({
      from: `"Boca Schedule" <no-reply@bocaschedule.com>`,
      to: p.email,
      subject: `Match cancelled — ${dateStr}`,
      text: [
        `Hi ${p.name},`,
        ``,
        `Unfortunately the match you were selected for has been cancelled.`,
        ``,
        `Date:     ${dateStr}`,
        `Time:     ${timeStr}`,
        `Location: ${match.location}${opponent}`,
      ].join('\n'),
      html: `
        <p>Hi <strong>${p.name}</strong>,</p>
        <p>Unfortunately the match you were selected for has been cancelled.</p>
        <table style="border-collapse:collapse;margin:16px 0">
          <tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:14px">Date</td><td style="font-size:14px;font-weight:600">${dateStr}</td></tr>
          <tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:14px">Time</td><td style="font-size:14px">${timeStr}</td></tr>
          <tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:14px">Location</td><td style="font-size:14px">${match.location}${opponent}</td></tr>
        </table>
      `,
    })
  ));
}

export async function sendReleaseNotification(
  coaches: { name: string; email: string }[],
  playerName: string,
  match: { matchDate: string; matchTime: string; location: string; opponent: string | null },
  frontendMatchId: string,
) {
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  const dateStr = new Date(`${match.matchDate}T${match.matchTime}`).toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long',
  });
  const timeStr = match.matchTime.slice(0, 5);
  const opponent = match.opponent ? ` vs ${match.opponent}` : '';

  await Promise.allSettled(coaches.map(c =>
    transporter.sendMail({
      from: `"Boca Schedule" <no-reply@bocaschedule.com>`,
      to: c.email,
      subject: `Spot released — ${playerName} · ${dateStr}`,
      text: [
        `Hi ${c.name},`,
        ``,
        `${playerName} has released their spot for the match on ${dateStr}.`,
        ``,
        `Date:     ${dateStr}`,
        `Time:     ${timeStr}`,
        `Location: ${match.location}${opponent}`,
        ``,
        `You may need to find a replacement or add a guest player:`,
        `${frontendUrl}/coach/matches/${frontendMatchId}/selections`,
      ].join('\n'),
      html: `
        <p>Hi <strong>${c.name}</strong>,</p>
        <p><strong>${playerName}</strong> has released their spot for the match on ${dateStr}.</p>
        <table style="border-collapse:collapse;margin:16px 0">
          <tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:14px">Date</td><td style="font-size:14px;font-weight:600">${dateStr}</td></tr>
          <tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:14px">Time</td><td style="font-size:14px">${timeStr}</td></tr>
          <tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:14px">Location</td><td style="font-size:14px">${match.location}${opponent}</td></tr>
        </table>
        <a href="${frontendUrl}/coach/matches/${frontendMatchId}/selections" style="display:inline-block;background:#16a34a;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-size:14px;font-weight:600">
          Manage squad →
        </a>
      `,
    })
  ));
}

export async function sendAdminRegistrationNotification(playerName: string, playerEmail: string) {
  const adminEmail = process.env.ADMIN_EMAIL || 'andreas@brendstrup.dk';
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

  await transporter.sendMail({
    from: `"Boca Schedule" <no-reply@bocaschedule.com>`,
    to: adminEmail,
    subject: `New registration: ${playerName}`,
    text: [
      `A new player has registered and is waiting for approval.`,
      ``,
      `Name:  ${playerName}`,
      `Email: ${playerEmail}`,
      ``,
      `Approve or reject the account in the admin panel:`,
      `${frontendUrl}/admin`,
    ].join('\n'),
    html: `
      <p>A new player has registered and is waiting for approval.</p>
      <table style="border-collapse:collapse;margin:16px 0">
        <tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:14px">Name</td><td style="font-size:14px;font-weight:600">${playerName}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:14px">Email</td><td style="font-size:14px">${playerEmail}</td></tr>
      </table>
      <a href="${frontendUrl}/admin" style="display:inline-block;background:#16a34a;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-size:14px;font-weight:600">
        Review in admin panel →
      </a>
    `,
  });
}
