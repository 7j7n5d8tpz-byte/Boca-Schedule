import { Router } from 'express';
import { supabaseAdmin } from '../lib/supabase.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireRole } from '../middleware/requireRole.js';

const router = Router();

const CONFIG_KEY = 'locations';

// GET /api/locations
router.get('/', authenticate, requireRole('coach', 'admin'), async (_req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('system_config')
      .select('config_value')
      .eq('config_key', CONFIG_KEY)
      .single();

    if (error && error.code !== 'PGRST116') throw error;

    const locations: string[] = data?.config_value ?? ['Kløvermarken', 'Valby Idrætsanlæg'];
    res.json({ success: true, data: locations });
  } catch (err) {
    next(err);
  }
});

// POST /api/locations — add a new venue
router.post('/', authenticate, requireRole('coach', 'admin'), async (req, res, next) => {
  try {
    const { name } = req.body as { name: string };
    if (!name || typeof name !== 'string' || !name.trim()) {
      res.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'name is required' } });
      return;
    }

    const trimmed = name.trim();

    const { data: existing } = await supabaseAdmin
      .from('system_config')
      .select('config_value')
      .eq('config_key', CONFIG_KEY)
      .single();

    const current: string[] = existing?.config_value ?? ['Kløvermarken', 'Valby Idrætsanlæg'];

    if (current.includes(trimmed)) {
      res.json({ success: true, data: current });
      return;
    }

    const updated = [...current, trimmed];

    await supabaseAdmin
      .from('system_config')
      .upsert({ config_key: CONFIG_KEY, config_value: updated, description: 'List of available match venues' }, { onConflict: 'config_key' });

    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/locations — remove a venue by name
router.delete('/', authenticate, requireRole('coach', 'admin'), async (req, res, next) => {
  try {
    const { name } = req.body as { name: string };
    if (!name || typeof name !== 'string' || !name.trim()) {
      res.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'name is required' } });
      return;
    }

    const trimmed = name.trim();

    const { data: existing } = await supabaseAdmin
      .from('system_config')
      .select('config_value')
      .eq('config_key', CONFIG_KEY)
      .single();

    const current: string[] = existing?.config_value ?? [];
    const updated = current.filter(l => l !== trimmed);

    await supabaseAdmin
      .from('system_config')
      .upsert({ config_key: CONFIG_KEY, config_value: updated, description: 'List of available match venues' }, { onConflict: 'config_key' });

    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
});

export default router;
