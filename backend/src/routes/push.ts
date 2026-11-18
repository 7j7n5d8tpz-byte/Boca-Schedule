import { Router } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../lib/supabase.js';
import { authenticate } from '../middleware/authenticate.js';
import { pushEnabled, vapidPublicKey, sendPush } from '../lib/push.js';

const router = Router();

// The backend POSTs to whatever endpoint a browser hands it, so only accept the
// browser vendors' push services — otherwise this is a request-forgery hole.
const PUSH_HOST_SUFFIXES = [
  'push.apple.com',                   // Safari / iOS home-screen apps
  'fcm.googleapis.com',               // Chrome, Android, Edge (Chromium)
  'push.services.mozilla.com',        // Firefox
  'notify.windows.com',               // legacy Edge / Windows
];

export function isPushEndpoint(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') return false;
    return PUSH_HOST_SUFFIXES.some(sfx => url.hostname === sfx || url.hostname.endsWith(`.${sfx}`));
  } catch {
    return false;
  }
}

const SubscriptionSchema = z.object({
  endpoint: z.string().max(2000).refine(isPushEndpoint, 'Not a known push service'),
  keys: z.object({
    p256dh: z.string().min(1).max(200),
    auth: z.string().min(1).max(100),
  }),
});

const EndpointSchema = z.object({ endpoint: z.string().max(2000) });

// GET /api/push/config — whether push is on, and the VAPID public key the
// browser needs to subscribe. Public: the key is not a secret.
router.get('/config', (_req, res) => {
  const enabled = pushEnabled();
  res.json({ success: true, data: { enabled, publicKey: enabled ? vapidPublicKey() : null } });
});

// POST /api/push/subscriptions — register (or refresh) this device for the
// current user. Upserts on endpoint, so a shared phone follows whoever is
// logged in and re-sending on every app start is harmless.
router.post('/subscriptions', authenticate, async (req, res, next) => {
  try {
    const parsed = SubscriptionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Ugyldigt push-abonnement' } });
      return;
    }
    const { endpoint, keys } = parsed.data;
    const { error } = await supabaseAdmin.from('push_subscriptions').upsert({
      user_id: req.user!.userId,
      endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
      user_agent: (req.header('user-agent') ?? '').slice(0, 300) || null,
      last_seen_at: new Date().toISOString(),
    }, { onConflict: 'endpoint' });
    if (error) throw error;
    res.status(201).json({ success: true });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/push/subscriptions — forget this device (opt-out or log-out).
router.delete('/subscriptions', authenticate, async (req, res, next) => {
  try {
    const parsed = EndpointSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Mangler endpoint' } });
      return;
    }
    const { error } = await supabaseAdmin.from('push_subscriptions')
      .delete().eq('endpoint', parsed.data.endpoint).eq('user_id', req.user!.userId);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/push/test — send a test notification to the current user's devices.
router.post('/test', authenticate, async (req, res, next) => {
  try {
    if (!pushEnabled()) {
      res.status(503).json({ success: false, error: { code: 'PUSH_DISABLED', message: 'Push-notifikationer er ikke slået til på serveren' } });
      return;
    }
    const result = await sendPush([req.user!.userId], {
      title: 'Boca Boldisch',
      body: 'Notifikationer virker. Vi giver besked, når vi mangler dig på banen.',
      url: '/settings',
      tag: 'push-test',
    });
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

export default router;
