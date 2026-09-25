import { Request, Response, NextFunction } from 'express';
import { supabaseAdmin } from '../lib/supabase.js';

export async function authenticate(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Du skal være logget ind' } });
    return;
  }

  const token = authHeader.slice(7);

  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) {
    res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Ugyldig eller udløbet token' } });
    return;
  }

  // Fetch role from our users table
  const { data: profile } = await supabaseAdmin
    .from('users')
    .select('role, merged_into')
    .eq('user_id', user.id)
    .single();

  // A merged-away duplicate account is retired: its still-valid tokens must not
  // keep acting as the tombstone (sign-ups would land on the dead account).
  if (profile?.merged_into) {
    res.status(401).json({ success: false, error: { code: 'ACCOUNT_MERGED', message: 'Denne konto er flettet ind i en anden konto' } });
    return;
  }

  req.user = {
    userId: user.id,
    email: user.email!,
    role: profile?.role ?? 'player',
  };

  next();
}
