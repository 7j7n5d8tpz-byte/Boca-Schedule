import { Router } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../lib/supabase.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireRole } from '../middleware/requireRole.js';

const router = Router();

router.use(authenticate, requireRole('admin'));

async function writeAudit(
  userId: string,
  action: string,
  entityType: string,
  entityId: string | null,
  oldValues?: object | null,
  newValues?: object | null,
) {
  await supabaseAdmin.from('audit_log').insert({
    user_id: userId,
    action,
    entity_type: entityType,
    entity_id: entityId,
    old_values: oldValues ?? null,
    new_values: newValues ?? null,
  });
}

// GET /api/admin/users
router.get('/users', async (req, res, next) => {
  try {
    const { role, isActive, isPlaceholder, search, limit = '50', offset = '0' } = req.query;

    // Hide merged tombstones — they're retired placeholders, not real accounts.
    let query = supabaseAdmin.from('users').select('*', { count: 'exact' }).is('merged_into', null);
    if (role) query = query.eq('role', role);
    if (isActive !== undefined) query = query.eq('is_active', isActive === 'true');
    if (isPlaceholder !== undefined) query = query.eq('is_placeholder', isPlaceholder === 'true');
    if (search) {
      // Strip characters that could inject extra PostgREST filter clauses
      const safeSearch = String(search).replace(/[(),]/g, '');
      query = query.or(`name.ilike.%${safeSearch}%,email.ilike.%${safeSearch}%`);
    }

    const { data, count, error } = await query
      .order('name')
      .range(parseInt(offset as string), parseInt(offset as string) + parseInt(limit as string) - 1);
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
          isPlaceholder: u.is_placeholder ?? false,
          canEnterResults: u.can_enter_results ?? false,
          isFineAdmin: u.is_fine_admin ?? false,
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

    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (authError) {
      res.status(400).json({ success: false, error: { code: 'CREATE_FAILED', message: authError.message } });
      return;
    }

    const userRole = role ?? 'player';
    await supabaseAdmin.from('users').insert({
      user_id: authData.user.id,
      email,
      name,
      role: userRole,
      preferred_positions: preferredPositions ?? [],
    });

    await writeAudit(req.user!.userId, 'user_created', 'user', authData.user.id, null, { email, name, role: userRole });

    res.status(201).json({
      success: true,
      data: { userId: authData.user.id, email, name, role: userRole, temporaryPassword: true },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/users/:placeholderId/merge
// Fold a historical-import placeholder into a real (registered) account: all of
// the placeholder's history moves across and the placeholder is retired. Done
// in a single SQL function (merge_placeholder_player) so it's atomic.
const MergeSchema = z.object({ targetUserId: z.string().uuid() });
router.post('/users/:placeholderId/merge', async (req, res, next) => {
  try {
    const { placeholderId } = req.params;
    const body = MergeSchema.safeParse(req.body);
    if (!body.success) {
      res.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'targetUserId (uuid) is required' } });
      return;
    }
    const { targetUserId } = body.data;

    const { data: pair } = await supabaseAdmin
      .from('users').select('user_id, name, is_placeholder, merged_into').in('user_id', [placeholderId, targetUserId]);
    const placeholder = (pair ?? []).find((u: any) => u.user_id === placeholderId);
    const target = (pair ?? []).find((u: any) => u.user_id === targetUserId);

    const { error } = await supabaseAdmin.rpc('merge_placeholder_player', {
      p_placeholder: placeholderId,
      p_target: targetUserId,
    });
    if (error) {
      res.status(400).json({ success: false, error: { code: 'MERGE_FAILED', message: error.message } });
      return;
    }

    await writeAudit(req.user!.userId, 'placeholder_merged', 'user', placeholderId,
      { name: placeholder?.name }, { mergedInto: targetUserId, targetName: target?.name });

    res.json({ success: true, message: 'Placeholder merged', data: { placeholderId, targetUserId } });
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

    const { data: target } = await supabaseAdmin.from('users').select('email, name, role').eq('user_id', userId).single();

    await supabaseAdmin.auth.admin.deleteUser(userId);
    await supabaseAdmin.from('users').delete().eq('user_id', userId);

    await writeAudit(req.user!.userId, 'user_deleted', 'user', userId, target ?? null, null);

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

    await writeAudit(req.user!.userId, 'role_changed', 'user', userId, { role: current?.role }, { role });

    res.json({ success: true, data: { userId, previousRole: current?.role, newRole: role, updatedAt: data.updated_at } });
  } catch (err) {
    next(err);
  }
});

// PUT /api/admin/users/:userId/active
router.put('/users/:userId/active', async (req, res, next) => {
  try {
    const { userId } = req.params;
    const { isActive } = req.body as { isActive: boolean };

    if (userId === req.user!.userId) {
      res.status(400).json({ success: false, error: { code: 'CANNOT_DEACTIVATE_SELF', message: 'Cannot deactivate your own account' } });
      return;
    }

    const { data: current } = await supabaseAdmin.from('users').select('is_active').eq('user_id', userId).single();
    const { data, error } = await supabaseAdmin.from('users').update({ is_active: isActive }).eq('user_id', userId).select().single();
    if (error) throw error;

    await writeAudit(req.user!.userId, isActive ? 'user_activated' : 'user_deactivated', 'user', userId, { isActive: current?.is_active }, { isActive });

    res.json({ success: true, data: { userId, isActive, updatedAt: data.updated_at } });
  } catch (err) {
    next(err);
  }
});

// PUT /api/admin/users/:userId/results-permission
router.put('/users/:userId/results-permission', async (req, res, next) => {
  try {
    const { userId } = req.params;
    const { canEnterResults } = req.body as { canEnterResults: boolean };

    const { data: current } = await supabaseAdmin.from('users').select('can_enter_results').eq('user_id', userId).single();
    const { data, error } = await supabaseAdmin.from('users').update({ can_enter_results: canEnterResults }).eq('user_id', userId).select().single();
    if (error) throw error;

    await writeAudit(req.user!.userId, 'results_permission_changed', 'user', userId, { canEnterResults: current?.can_enter_results }, { canEnterResults });

    res.json({ success: true, data: { userId, canEnterResults, updatedAt: data.updated_at } });
  } catch (err) {
    next(err);
  }
});

// PUT /api/admin/users/:userId/fine-admin — toggle fine-admin powers
router.put('/users/:userId/fine-admin', async (req, res, next) => {
  try {
    const { userId } = req.params;
    const { isFineAdmin } = req.body as { isFineAdmin: boolean };

    const { data: current } = await supabaseAdmin.from('users').select('is_fine_admin').eq('user_id', userId).single();
    const { data, error } = await supabaseAdmin.from('users').update({ is_fine_admin: isFineAdmin }).eq('user_id', userId).select().single();
    if (error) throw error;

    await writeAudit(req.user!.userId, 'fine_admin_changed', 'user', userId, { isFineAdmin: current?.is_fine_admin }, { isFineAdmin });

    res.json({ success: true, data: { userId, isFineAdmin, updatedAt: data.updated_at } });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/system/health
router.get('/system/health', async (_req, res, next) => {
  try {
    const { error: dbError } = await supabaseAdmin.from('users').select('user_id', { head: true, count: 'exact' });

    // The optimizer now runs in-process (HiGHS-WASM, see lib/optimizer.ts) rather
    // than as a separate Julia service, so it is healthy whenever the API is up.
    const optimizationService: { status: 'healthy' | 'unhealthy' | 'not_configured' } = { status: 'healthy' };

    res.json({
      success: true,
      data: {
        database: { status: dbError ? 'unhealthy' : 'healthy', message: dbError?.message ?? null },
        api: { uptime: process.uptime(), uptimeHuman: formatUptime(process.uptime()) },
        optimizationService,
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/system/config
router.get('/system/config', async (_req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin.from('system_config').select('*').order('config_key');
    if (error) throw error;
    res.json({
      success: true,
      data: (data ?? []).map((c: any) => ({
        key: c.config_key,
        value: c.config_value,
        description: c.description,
        updatedAt: c.updated_at,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/audit-log
router.get('/audit-log', async (req, res, next) => {
  try {
    const { userId, action, entityType, limit = '100', offset = '0' } = req.query;

    let query = supabaseAdmin
      .from('audit_log')
      .select('*, actor:users!audit_log_user_id_fkey(name, email)', { count: 'exact' });
    if (userId) query = query.eq('user_id', userId);
    if (action) query = query.eq('action', action);
    if (entityType) query = query.eq('entity_type', entityType);

    const { data, count, error } = await query
      .order('created_at', { ascending: false })
      .range(parseInt(offset as string), parseInt(offset as string) + parseInt(limit as string) - 1);

    if (error) throw error;

    res.json({
      success: true,
      data: {
        logs: (data ?? []).map((l: any) => ({
          logId: l.log_id,
          userId: l.user_id,
          actorName: l.actor?.name ?? 'Unknown',
          actorEmail: l.actor?.email ?? '',
          action: l.action,
          entityType: l.entity_type,
          entityId: l.entity_id,
          oldValues: l.old_values,
          newValues: l.new_values,
          createdAt: l.created_at,
        })),
        pagination: { total: count ?? 0, limit: parseInt(limit as string), offset: parseInt(offset as string) },
      },
    });
  } catch (err) {
    next(err);
  }
});

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export default router;
