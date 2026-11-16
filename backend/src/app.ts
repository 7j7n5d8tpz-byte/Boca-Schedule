import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { errorHandler } from './middleware/errorHandler.js';
import { supabaseAdmin } from './lib/supabase.js';
import authRoutes from './routes/auth.js';
import matchRoutes from './routes/matches.js';
import signupRoutes from './routes/signups.js';
import playerRoutes from './routes/players.js';
import adminRoutes from './routes/admin.js';
import optimizeRoutes from './routes/optimize.js';
import claimRoutes from './routes/claims.js';
import resultRoutes from './routes/results.js';
import locationRoutes from './routes/locations.js';
import batchOptimizeRoutes from './routes/batch-optimize.js';
import cronRoutes from './routes/cron.js';
import calendarRoutes from './routes/calendar.js';
import announcementRoutes from './routes/announcements.js';
import notificationRoutes from './routes/notifications.js';
import fineRoutes from './routes/fines.js';
import opponentRoutes from './routes/opponents.js';
import achievementRoutes from './routes/achievements.js';

const app = express();

// Behind Fly.io's proxy, every request reaches us via one proxy hop. Trust it so
// req.ip is the real client IP rather than the proxy's. Without this,
// express-rate-limit keys every request by the same proxy IP — collapsing all
// users into a single shared bucket (and logging ERR_ERL_UNEXPECTED_X_FORWARDED_FOR
// on every request), which throttles legitimate traffic including login.
app.set('trust proxy', 1);

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
}));

// Avatar uploads carry a base64 image, which can exceed the default 100 kb JSON
// limit. Parse this one path with a higher cap *before* the global parser; once
// body-parser has run, the global express.json() below is a no-op for it.
app.use('/api/players/:playerId/avatar', express.json({ limit: '4mb' }));

app.use(express.json());

const isTest = process.env.NODE_ENV === 'test';
const windowMs = 15 * 60 * 1000;
// Production traffic arrives through the Vercel /api rewrite, so req.ip is a
// Vercel egress address shared by the whole club — an IP-keyed limit of 300
// throttled everyone together. So the address only gets a flood guard, sized
// for the club sharing it, and the per-client limit is keyed on the login token.
const floodLimiter = rateLimit({ windowMs, max: isTest ? 100_000 : 5000 });
// General per-client limit. Generous enough for the app's background polling
// (notification bell every 30s, admin/coach dashboards).
const limiter = rateLimit({
  windowMs,
  max: isTest ? 10_000 : 300,
  keyGenerator: req => req.headers.authorization ?? req.ip ?? '',
});
// Strict brute-force protection for credential endpoints only — scoped to the
// sensitive routes below, NOT all of /api/auth, so token refresh and logout
// (which the frontend calls automatically) don't consume the budget. Keyed on
// the account being tried, not the shared address: ten players logging in
// after a club-wide email must not lock the eleventh out.
const authLimiter = rateLimit({
  windowMs,
  max: isTest ? 10_000 : 10,
  keyGenerator: req => (typeof req.body?.email === 'string' && req.body.email.trim().toLowerCase()) || req.ip || '',
});

app.use(floodLimiter);
app.use(limiter);

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// Unlike /health (process-only), this issues a real Supabase query, so it tells
// "backend up" apart from "backend up but the database is unreachable or paused".
// Public and intentionally cheap (a head count, no rows transferred).
app.get('/health/db', async (_req, res) => {
  const { error } = await supabaseAdmin.from('users').select('user_id', { head: true, count: 'exact' });
  if (error) {
    res.status(503).json({ status: 'error', db: 'unreachable', message: error.message });
    return;
  }
  res.json({ status: 'ok', db: 'reachable' });
});

app.use(
  ['/api/auth/login', '/api/auth/register', '/api/auth/forgot-password', '/api/auth/reset-password'],
  authLimiter,
);
app.use('/api/auth', authRoutes);
app.use('/api/matches', matchRoutes);
app.use('/api/matches/:matchId', optimizeRoutes);
app.use('/api/signups', signupRoutes);
app.use('/api/players', playerRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api', claimRoutes);
app.use('/api', resultRoutes);
app.use('/api', achievementRoutes);
app.use('/api/locations', locationRoutes);
app.use('/api/opponents', opponentRoutes);
app.use('/api/optimize', batchOptimizeRoutes);
app.use('/api/cron', cronRoutes);
app.use('/api/calendar', calendarRoutes);
app.use('/api/announcements', announcementRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api', fineRoutes);

app.use(errorHandler);

export default app;
