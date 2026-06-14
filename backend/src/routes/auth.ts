import { Router } from 'express';
import { z } from 'zod';
import { supabaseAdmin, supabaseAnon } from '../lib/supabase.js';
import { authenticate } from '../middleware/authenticate.js';
import { sendAdminRegistrationNotification } from '../lib/mailer.js';
import { createNotifications } from '../lib/notifications.js';

const router = Router();

const RegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).regex(/[A-Z]/).regex(/[0-9]/).regex(/[!@#$%^&*]/),
  name: z.string().min(2).max(100),
  preferredPositions: z.array(z.enum(['GK', 'DEF', 'WIN', 'MID', 'STR'])).optional(),
});

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// POST /api/auth/register
// Security: always returns the same 201 response regardless of whether the email
// is already registered — prevents enumeration of existing accounts.
router.post('/register', async (req, res, next) => {
  try {
    const body = RegisterSchema.safeParse(req.body);
    if (!body.success) {
      res.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: body.error.issues } });
      return;
    }

    const { email, password, name, preferredPositions } = body.data;

    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (!authError && authData?.user) {
      // New account — create profile, inactive until admin approves
      const { error: profileError } = await supabaseAdmin.from('users').insert({
        user_id: authData.user.id,
        email,
        name,
        role: 'player',
        preferred_positions: preferredPositions ?? [],
        is_active: false,
      });
      if (profileError) {
        supabaseAdmin.auth.admin.deleteUser(authData.user.id);
      } else {
        // Notify admin — fire-and-forget, don't block the response
        sendAdminRegistrationNotification(name, email).catch(err =>
          console.error('Failed to send admin registration notification:', err)
        );
        supabaseAdmin.from('users').select('user_id').eq('role', 'admin').eq('is_active', true)
          .then(({ data: admins }) => {
            createNotifications((admins ?? []).map((a: any) => a.user_id), {
              type: 'registration',
              title: 'New registration',
              body: `${name} is awaiting approval`,
              link: '/admin',
            });
          });
      }
    }
    // If authError (e.g. email already registered), we intentionally fall through
    // and return the same response to prevent email enumeration.

    res.status(201).json({
      success: true,
      message: 'If that email address is valid and not already in use, your registration request has been submitted. An administrator will review and activate your account.',
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/login
router.post('/login', async (req, res, next) => {
  try {
    const body = LoginSchema.safeParse(req.body);
    if (!body.success) {
      res.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid input' } });
      return;
    }

    const { email, password } = body.data;

    // Password grant must use the anon/publishable key — GoTrue forbids it with the service_role key.
    const { data, error } = await supabaseAnon.auth.signInWithPassword({ email, password });
    if (error || !data.session) {
      res.status(401).json({ success: false, error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' } });
      return;
    }

    const { data: profile } = await supabaseAdmin.from('users').select('*').eq('user_id', data.user.id).single();

    // Inactive accounts (pending admin approval) return the same error as bad credentials
    // to avoid revealing that the account exists but isn't approved yet.
    if (!profile?.is_active) {
      res.status(401).json({ success: false, error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' } });
      return;
    }

    await supabaseAdmin.from('users').update({ last_login: new Date().toISOString() }).eq('user_id', data.user.id);

    res.json({
      success: true,
      data: {
        user: {
          userId: data.user.id,
          email: data.user.email,
          name: profile?.name,
          role: profile?.role,
          preferredPositions: profile?.preferred_positions,
          avatarUrl: profile?.avatar_url ?? null,
          isFineAdmin: profile?.role === 'admin' || (profile?.is_fine_admin ?? false),
        },
        tokens: {
          accessToken: data.session.access_token,
          refreshToken: data.session.refresh_token,
          expiresIn: data.session.expires_in,
        },
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/refresh
router.post('/refresh', async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'refreshToken required' } });
      return;
    }

    // Use the anon client: refreshSession mutates the client's session, and the
    // shared supabaseAdmin must stay on service_role (RLS bypass) for every other
    // query — otherwise a refresh poisons it and all later profile reads return 0
    // rows under RLS. See lib/supabase.ts.
    const { data, error } = await supabaseAnon.auth.refreshSession({ refresh_token: refreshToken });
    if (error || !data.session) {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid refresh token' } });
      return;
    }

    res.json({ success: true, data: { accessToken: data.session.access_token, expiresIn: data.session.expires_in } });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/forgot-password
router.post('/forgot-password', async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email || typeof email !== 'string') {
      res.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Email is required' } });
      return;
    }
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    await supabaseAdmin.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: `${frontendUrl}/reset-password`,
    });
    // Always return 200 — prevents email enumeration
    res.json({ success: true, message: 'If that email is registered, a reset link has been sent.' });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/reset-password
router.post('/reset-password', async (req, res, next) => {
  try {
    const { accessToken, newPassword } = req.body;
    if (!accessToken || !newPassword) {
      res.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'accessToken and newPassword are required' } });
      return;
    }

    const passwordCheck = z.string().min(8).regex(/[A-Z]/).regex(/[0-9]/).regex(/[!@#$%^&*]/).safeParse(newPassword);
    if (!passwordCheck.success) {
      res.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Password must be at least 8 characters and include an uppercase letter, a number, and a special character (!@#$%^&*).' } });
      return;
    }

    const { data: { user }, error } = await supabaseAdmin.auth.getUser(accessToken);
    if (error || !user) {
      res.status(401).json({ success: false, error: { code: 'INVALID_TOKEN', message: 'Invalid or expired reset link — please request a new one.' } });
      return;
    }

    // Ensure this token came from a password-recovery flow, not a regular session
    const payload = JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64url').toString());
    if (payload?.type !== 'recovery' && payload?.aal !== 'aal1') {
      // Supabase recovery tokens set amr to [{"method":"otp"}] and token_type may differ
      // Fall back to checking the amr claim for 'otp' which recovery tokens carry
      const isRecovery = (payload?.amr ?? []).some((a: any) => a.method === 'otp');
      if (!isRecovery) {
        res.status(401).json({ success: false, error: { code: 'INVALID_TOKEN', message: 'Invalid or expired reset link — please request a new one.' } });
        return;
      }
    }

    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(user.id, { password: newPassword });
    if (updateError) throw updateError;

    res.json({ success: true, message: 'Password updated successfully.' });
  } catch (err) {
    next(err);
  }
});

// PUT /api/auth/change-password
router.put('/change-password', authenticate, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      res.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'currentPassword and newPassword are required' } });
      return;
    }

    const passwordCheck = z.string().min(8).regex(/[A-Z]/).regex(/[0-9]/).regex(/[!@#$%^&*]/).safeParse(newPassword);
    if (!passwordCheck.success) {
      res.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Password must be at least 8 characters and include an uppercase letter, a number, and a special character (!@#$%^&*).' } });
      return;
    }

    const { data: profile } = await supabaseAdmin.from('users').select('email').eq('user_id', req.user!.userId).single();
    if (!profile?.email) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'User not found' } });
      return;
    }

    // Verify on the anon client — signInWithPassword mutates the client's session,
    // which must never happen to the shared service_role supabaseAdmin.
    const { error: verifyError } = await supabaseAnon.auth.signInWithPassword({ email: profile.email, password: currentPassword });
    if (verifyError) {
      res.status(401).json({ success: false, error: { code: 'INVALID_CREDENTIALS', message: 'Current password is incorrect' } });
      return;
    }

    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(req.user!.userId, { password: newPassword });
    if (updateError) throw updateError;

    res.json({ success: true, message: 'Password updated successfully.' });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/logout
router.post('/logout', authenticate, async (req, res, next) => {
  try {
    await supabaseAdmin.auth.admin.signOut(req.headers.authorization!.slice(7));
    res.json({ success: true, message: 'Logged out successfully' });
  } catch (err) {
    next(err);
  }
});

export default router;
