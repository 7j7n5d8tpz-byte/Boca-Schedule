export type Role = 'player' | 'coach' | 'admin';

interface AuthUser {
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
