import { Router } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../lib/supabase.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireRole } from '../middleware/requireRole.js';

const router = Router();

// All admin routes require admin role
router.use(authenticate, requireRole('admin'));

// GET /api/admin/users
router.get('/users', async (req, res, next) => {
  try {
    const { role, isActive, search, limit = '50', offset = '0' } = req.query;

    let query = supabaseAdmin.from('users').select('*', { count: 'exact' });
    if (role) query = query.eq('role', role);
    if (isActive !== undefined) query = query.eq('is_active', isActive === 'true');
    if (search) query = query.or(`name.ilike.%${search}%,email.ilike.%${search}%`);

    const { data, count, error } = await query.range(parseInt(offset as string), parseInt(offset as string) + parseInt(limit as string) - 1);
    if (error) throw error;

    res.json({
      success: true,
      data: {
        users: (data ?? []).map((u: any) => ({
          userId: u.user_id,
          email: u.email,
          name: u.name,
          role: u.role,
          isActive: u.is_active,
          createdAt: u.created_at,
          lastLogin: u.last_login,
        })),
        pagination: { total: count ?? 0, limit: parseInt(limit as string), offset: parseInt(offset as string) },
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/users
router.post('/users', async (req, res, next) => {
  try {
    const { email, password, name, role, preferredPositions } = req.body;

    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({ email, password, email_confirm: true });
    if (authError) {
      res.status(400).json({ success: false, error: { code: 'CREATE_FAILED', message: authError.message } });
      return;
    }

    await supabaseAdmin.from('users').insert({ user_id: authData.user.id, email, name, role: role ?? 'player', preferred_positions: preferredPositions ?? [] });

    res.status(201).json({ success: true, data: { userId: authData.user.id, email, name, role: role ?? 'player', temporaryPassword: true } });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/admin/users/:userId
router.delete('/users/:userId', async (req, res, next) => {
  try {
    const { userId } = req.params;

    if (userId === req.user!.userId) {
      res.status(400).json({ success: false, error: { code: 'CANNOT_DELETE_SELF', message: 'Cannot delete your own account' } });
      return;
    }

    // Cascade deletes handled by DB foreign keys
    await supabaseAdmin.auth.admin.deleteUser(userId);
    await supabaseAdmin.from('users').delete().eq('user_id', userId);

    res.json({ success: true, message: 'User deleted successfully', data: { deletedUserId: userId } });
  } catch (err) {
    next(err);
  }
});

// PUT /api/admin/users/:userId/role
router.put('/users/:userId/role', async (req, res, next) => {
  try {
    const { userId } = req.params;
    const { role } = req.body;

    if (userId === req.user!.userId) {
      res.status(400).json({ success: false, error: { code: 'CANNOT_CHANGE_OWN_ROLE', message: 'Cannot change your own role' } });
      return;
    }

    const { data: current } = await supabaseAdmin.from('users').select('role').eq('user_id', userId).single();
    const { data, error } = await supabaseAdmin.from('users').update({ role }).eq('user_id', userId).select().single();
    if (error) throw error;

    res.json({ success: true, data: { userId, previousRole: current?.role, newRole: role, updatedAt: data.updated_at } });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/system/health
router.get('/system/health', async (_req, res, next) => {
  try {
    const { error: dbError } = await supabaseAdmin.from('users').select('user_id', { head: true, count: 'exact' });
    res.json({
      success: true,
      data: {
        database: { status: dbError ? 'unhealthy' : 'healthy' },
        api: { uptime: process.uptime() },
        optimizationService: { status: 'not_configured' },
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/audit-log
router.get('/audit-log', async (req, res, next) => {
  try {
    const { userId, action, entityType, limit = '100', offset = '0' } = req.query;

    let query = supabaseAdmin.from('audit_log').select('*', { count: 'exact' });
    if (userId) query = query.eq('user_id', userId);
    if (action) query = query.eq('action', action);
    if (entityType) query = query.eq('entity_type', entityType);

    const { data, count, error } = await query
      .order('created_at', { ascending: false })
      .range(parseInt(offset as string), parseInt(offset as string) + parseInt(limit as string) - 1);

    if (error) throw error;

    res.json({ success: true, data: { logs: data ?? [], pagination: { total: count ?? 0, limit: parseInt(limit as string), offset: parseInt(offset as string) } } });
  } catch (err) {
    next(err);
  }
});

export default router;
