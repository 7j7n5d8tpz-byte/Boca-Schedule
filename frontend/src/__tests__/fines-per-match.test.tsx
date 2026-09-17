import { cloneElement } from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import FinesStats from '../pages/player/FinesStats';

const { mockGet } = vi.hoisted(() => ({ mockGet: vi.fn() }));
vi.mock('../api/client', () => ({ api: { get: mockGet } }));

// Recharts measures its container, and jsdom reports every element as 0×0 — so the
// chart renders nothing unless the size is handed to it directly.
vi.mock('recharts', async () => {
  const actual = await vi.importActual<any>('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: any) => cloneElement(children, { width: 400, height: 220 }),
  };
});

const match = (n: number, totalDkk: number, lines: any[] = []) => ({
  matchId: `m${n}`, matchDate: `2026-0${n}-01`, label: `1. maj vs Klub ${n}`,
  totalDkk, count: lines.length, lines,
});

const STATS = {
  availableYears: [2026],
  pot: { collectedDkk: 100, outstandingDkk: 50, totalDkk: 150 },
  topFined: [{ playerId: 'p1', name: 'Anders And', totalDkk: 150, count: 2 }],
  topPerGame: [], saints: [], favouriteFine: { label: 'Dumt gult kort', count: 1, totalDkk: 50 },
  perGameDkk: 50, biggestFine: null, mostExpensiveMatch: null,
  perMatch: [
    match(3, 150, [
      { playerName: 'Anders And', label: 'Dumt gult kort', amountDkk: 100 },
      { playerName: 'Bodil Bang', label: 'Glemt udstyr', amountDkk: 50 },
    ]),
    match(2, 0),
    match(1, 25, [{ playerName: 'Anders And', label: 'Brug af skohorn', amountDkk: 25 }]),
  ],
  typeBreakdown: [{ label: 'Dumt gult kort', count: 1, totalDkk: 50 }],
  overTime: [],
  fineCount: 3,
};

function renderStats(data: any = STATS) {
  mockGet.mockImplementation(() => Promise.resolve({ data: { data } }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><FinesStats /></QueryClientProvider>);
}

// The panel opens on the chart; the table is behind the toggle.
async function showTable() {
  await userEvent.click(screen.getByRole('button', { name: 'Table' }));
}

// The table (sm+) and the stacked cards (phones) are both in the DOM — jsdom applies no
// media queries — so scope assertions to the table to avoid matching each row twice.
const table = () => screen.getByRole('table');

describe('FinesStats — fines per match', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows the chart first, one column per match', async () => {
    const { container } = renderStats();
    await waitFor(() => expect(screen.getByText('Fines per match')).toBeInTheDocument());

    // No table until it is asked for.
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    // A column per match, zero-fine ones included.
    expect(container.querySelectorAll('.recharts-bar-rectangle')).toHaveLength(3);
    expect(screen.getByText(/Tap a column/)).toBeInTheDocument();
  });

  it('lists every match, including ones with no fines', async () => {
    renderStats();
    await waitFor(() => expect(screen.getByText('Fines per match')).toBeInTheDocument());
    await showTable();

    const rows = within(table()).getAllByRole('row').slice(1); // drop the header
    expect(rows).toHaveLength(3);
    // Newest first, and the clean match still gets a row at 0 kr.
    expect(rows[0]).toHaveTextContent('Klub 3');
    expect(rows[1]).toHaveTextContent('Klub 2');
    expect(rows[1]).toHaveTextContent('0 kr');
  });

  it('expands a match to its individual fines, and only that match', async () => {
    renderStats();
    await waitFor(() => expect(screen.getByText('Fines per match')).toBeInTheDocument());
    await showTable();

    expect(within(table()).queryByText(/Dumt gult kort/)).not.toBeInTheDocument();

    await userEvent.click(within(table()).getByText('1. maj vs Klub 3'));
    expect(within(table()).getByText(/Dumt gult kort/)).toBeInTheDocument();
    expect(within(table()).getByText(/Glemt udstyr/)).toBeInTheDocument();
    expect(within(table()).queryByText(/Brug af skohorn/)).not.toBeInTheDocument();

    await userEvent.click(within(table()).getByText('1. maj vs Klub 3'));
    expect(within(table()).queryByText(/Dumt gult kort/)).not.toBeInTheDocument();
  });

  it('does not expand a match with no fines', async () => {
    renderStats();
    await waitFor(() => expect(screen.getByText('Fines per match')).toBeInTheDocument());
    await showTable();

    const before = within(table()).getAllByRole('row').length;
    await userEvent.click(within(table()).getByText('1. maj vs Klub 2'));
    expect(within(table()).getAllByRole('row')).toHaveLength(before);
  });

  it('collapses a long list behind a show-all toggle', async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      matchId: `x${i}`, matchDate: `2026-01-${String(i + 1).padStart(2, '0')}`,
      label: `Kamp ${i}`, totalDkk: 0, count: 0, lines: [],
    }));
    renderStats({ ...STATS, perMatch: many });
    await waitFor(() => expect(screen.getByText('Fines per match')).toBeInTheDocument());
    await showTable();

    expect(within(table()).getAllByRole('row').slice(1)).toHaveLength(10);
    await userEvent.click(screen.getByText('Show all 12 matches'));
    expect(within(table()).getAllByRole('row').slice(1)).toHaveLength(12);
  });
});
