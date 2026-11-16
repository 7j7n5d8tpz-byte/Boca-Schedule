import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { AuthProvider, useAuth } from '../context/AuthContext';

// Mock the API client at module level — hoisted before any imports
vi.mock('../api/client', () => ({
  api: {
    post: vi.fn().mockResolvedValue({ data: {} }),
  },
}));

// ── Test consumer ─────────────────────────────────────────────────────────────

function TestConsumer() {
  const { user, isAuthenticated, logout } = useAuth();
  return (
    <div>
      <span data-testid="auth">{isAuthenticated ? 'yes' : 'no'}</span>
      <span data-testid="name">{user?.name ?? 'none'}</span>
      <span data-testid="role">{user?.role ?? 'none'}</span>
      <button onClick={logout}>logout</button>
    </div>
  );
}

const mockUser = {
  userId: 'abc-123',
  email: 'player@test.com',
  name: 'Test Player',
  role: 'player' as const,
  preferredPositions: ['MID'],
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AuthContext', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('starts unauthenticated when localStorage is empty', () => {
    render(<AuthProvider><TestConsumer /></AuthProvider>);
    expect(screen.getByTestId('auth').textContent).toBe('no');
    expect(screen.getByTestId('name').textContent).toBe('none');
  });

  it('restores session from localStorage', () => {
    localStorage.setItem('user', JSON.stringify(mockUser));
    localStorage.setItem('accessToken', 'tok');
    localStorage.setItem('lastActivity', String(Date.now()));

    render(<AuthProvider><TestConsumer /></AuthProvider>);
    expect(screen.getByTestId('auth').textContent).toBe('yes');
    expect(screen.getByTestId('name').textContent).toBe('Test Player');
    expect(screen.getByTestId('role').textContent).toBe('player');
  });

  it('keeps a session that was last used yesterday', () => {
    // Players open the app a few times a week; a day away must not log them out.
    localStorage.setItem('user', JSON.stringify(mockUser));
    localStorage.setItem('accessToken', 'tok');
    localStorage.setItem('lastActivity', String(Date.now() - 24 * 60 * 60 * 1000));

    render(<AuthProvider><TestConsumer /></AuthProvider>);
    expect(screen.getByTestId('auth').textContent).toBe('yes');
  });

  it('treats an expired session as logged-out', () => {
    const monthAgo = Date.now() - 31 * 24 * 60 * 60 * 1000; // limit is 30 days
    localStorage.setItem('user', JSON.stringify(mockUser));
    localStorage.setItem('accessToken', 'tok');
    localStorage.setItem('lastActivity', String(monthAgo));

    render(<AuthProvider><TestConsumer /></AuthProvider>);
    expect(screen.getByTestId('auth').textContent).toBe('no');
  });

  it('logout clears state and localStorage', async () => {
    localStorage.setItem('user', JSON.stringify(mockUser));
    localStorage.setItem('accessToken', 'tok');
    localStorage.setItem('lastActivity', String(Date.now()));

    render(<AuthProvider><TestConsumer /></AuthProvider>);
    expect(screen.getByTestId('auth').textContent).toBe('yes');

    await act(async () => {
      screen.getByRole('button', { name: 'logout' }).click();
    });

    expect(screen.getByTestId('auth').textContent).toBe('no');
    expect(localStorage.getItem('accessToken')).toBeNull();
    expect(localStorage.getItem('user')).toBeNull();
  });
});
