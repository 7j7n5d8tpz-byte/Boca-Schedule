export type Role = 'player' | 'coach' | 'admin';
export type Position = 'GK' | 'DEF' | 'WIN' | 'MID' | 'STR';
export type MatchType = 'futsal' | '7-player' | '11-player';
export type MatchStatus = 'draft' | 'signup_open' | 'signup_closed' | 'optimized' | 'published' | 'completed';

export interface AuthUser {
  userId: string;
  email: string;
  role: Role;
}

// Extend Express Request with authenticated user
declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}
