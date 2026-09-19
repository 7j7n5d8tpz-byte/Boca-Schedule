import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ManageFines } from '../pages/player/FinesView';

const { mockGet } = vi.hoisted(() => ({ mockGet: vi.fn() }));
vi.mock('../api/client', () => ({ api: { get: mockGet, post: vi.fn(), put: vi.fn() } }));
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: { userId: 'admin1', name: 'Fine Admin', role: 'player', isFineAdmin: true } }),
}));

const ADMIN = {
  pendingApproval: [], paymentClaimed: [], overview: [],
  treasury: { collectedDkk: 0, outstandingDkk: 0 }, paymentInfo: '12345678',
};

// Today's match, the one before it, and one still to come.
const MATCHES = [
  { matchId: 'next', matchDate: '2026-06-20', label: 'lør. 20. jun vs Næste' },
  { matchId: 'today', matchDate: '2026-06-10', label: 'ons. 10. jun vs I dag' },
  { matchId: 'past', matchDate: '2026-06-03', label: 'ons. 3. jun vs Sidste' },
];

const ROUTES: Record<string, any> = {
  '/fines/admin': ADMIN,
  '/fines': [],
  '/fines/matches': MATCHES,
  '/fine-types': [{ fineTypeId: 'ft1', label: 'Dumt gult kort', amountDkk: 50, active: true, sortOrder: 1 }],
  '/players': [{ userId: 'p1', name: 'Anders And' }],
};

function renderManage() {
  mockGet.mockImplementation((url: string) => Promise.resolve({ data: { data: ROUTES[url] ?? [] } }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><ManageFines /></QueryClientProvider>);
}

// The match picker is the only select holding a "No match" option.
const matchSelect = () =>
  screen.getAllByRole('combobox').find(el => el.textContent?.includes('No match')) as HTMLSelectElement;

async function openIssueForm() {
  renderManage();
  await waitFor(() => expect(screen.getByRole('button', { name: '+ Issue a fine' })).toBeInTheDocument());
  await userEvent.click(screen.getByRole('button', { name: '+ Issue a fine' }));
  await waitFor(() => expect(matchSelect()).toBeTruthy());
}

describe('Issue a fine — default match', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => vi.useRealTimers());

  it("opens on today's match — fines are handed out around kick-off", async () => {
    vi.setSystemTime(new Date(2026, 5, 10, 19, 0)); // match day, just before kick-off
    await openIssueForm();
    await waitFor(() => expect(matchSelect().value).toBe('today'));
  });

  it('falls back to the last played match on a non-match day', async () => {
    vi.setSystemTime(new Date(2026, 5, 12, 10, 0));
    await openIssueForm();
    await waitFor(() => expect(matchSelect().value).toBe('today')); // 10 Jun is now the latest played
  });

  it('keeps the admin\'s own choice, including "No match"', async () => {
    vi.setSystemTime(new Date(2026, 5, 10, 19, 0));
    await openIssueForm();
    await waitFor(() => expect(matchSelect().value).toBe('today'));

    await userEvent.selectOptions(matchSelect(), 'past');
    expect(matchSelect().value).toBe('past');

    await userEvent.selectOptions(matchSelect(), '');
    expect(matchSelect().value).toBe('');
  });
});
