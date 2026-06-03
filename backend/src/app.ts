import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { errorHandler } from './middleware/errorHandler.js';
import authRoutes from './routes/auth.js';
import matchRoutes from './routes/matches.js';
import signupRoutes from './routes/signups.js';
import playerRoutes from './routes/players.js';
import adminRoutes from './routes/admin.js';
import optimizeRoutes from './routes/optimize.js';
import swapRoutes from './routes/swaps.js';
import resultRoutes from './routes/results.js';
import locationRoutes from './routes/locations.js';
import batchOptimizeRoutes from './routes/batch-optimize.js';
import cronRoutes from './routes/cron.js';
import calendarRoutes from './routes/calendar.js';
import announcementRoutes from './routes/announcements.js';
import notificationRoutes from './routes/notifications.js';

const app = express();

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
}));

app.use(express.json());

const isTest = process.env.NODE_ENV === 'test';
const limiter     = rateLimit({ windowMs: 15 * 60 * 1000, max: isTest ? 10_000 : 100 });
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: isTest ? 10_000 : 5 });

app.use(limiter);

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/matches', matchRoutes);
app.use('/api/matches/:matchId', optimizeRoutes);
app.use('/api/signups', signupRoutes);
app.use('/api/players', playerRoutes);
app.use('/api/matches', playerRoutes); // performance endpoint lives under /api/matches/:matchId/performance
app.use('/api/admin', adminRoutes);
app.use('/api', swapRoutes);
app.use('/api', resultRoutes);
app.use('/api/locations', locationRoutes);
app.use('/api/optimize', batchOptimizeRoutes);
app.use('/api/cron', cronRoutes);
app.use('/api/calendar', calendarRoutes);
app.use('/api/announcements', announcementRoutes);
app.use('/api/notifications', notificationRoutes);

app.use(errorHandler);

export default app;
