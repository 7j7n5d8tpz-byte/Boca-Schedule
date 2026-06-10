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

app.use(express.json());

const isTest = process.env.NODE_ENV === 'test';
// General per-client limit. Generous enough for the app's background polling
// (notification bell every 30s, admin/coach dashboards) now that each client
// gets its own bucket.
const limiter     = rateLimit({ windowMs: 15 * 60 * 1000, max: isTest ? 10_000 : 300 });
// Strict brute-force protection for credential endpoints only — scoped to the
// sensitive routes below, NOT all of /api/auth, so token refresh and logout
// (which the frontend calls automatically) don't consume the budget.
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: isTest ? 10_000 : 10 });

app.use(limiter);

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// Keepalive: unlike /health (process-only), this issues a real Supabase query so
// a scheduled ping resets the free-tier project's 7-day inactivity pause timer.
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
app.use('/api/matches', playerRoutes); // performance endpoint lives under /api/matches/:matchId/performance
app.use('/api/admin', adminRoutes);
app.use('/api', claimRoutes);
app.use('/api', resultRoutes);
app.use('/api/locations', locationRoutes);
app.use('/api/optimize', batchOptimizeRoutes);
app.use('/api/cron', cronRoutes);
app.use('/api/calendar', calendarRoutes);
app.use('/api/announcements', announcementRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api', fineRoutes);

app.use(errorHandler);

export default app;
