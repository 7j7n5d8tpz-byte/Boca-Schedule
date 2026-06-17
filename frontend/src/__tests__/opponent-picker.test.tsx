import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import OpponentPicker from '../components/OpponentPicker';

const { mockGet, mockPost } = vi.hoisted(() => ({ mockGet: vi.fn(), mockPost: vi.fn() }));
vi.mock('../api/client', () => ({ api: { get: mockGet, post: mockPost } }));

const OPPONENTS = [
  { opponentId: 'opp-1', name: 'FC Alpha', matchesPlayed: 3 },
  { opponentId: 'opp-2', name: 'FC Beta', matchesPlayed: 0 },
];

function renderPicker(onChange = vi.fn(), opponentId: string | null = null) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <OpponentPicker opponentId={opponentId} onChange={onChange} />
    </QueryClientProvider>,
  );
  return onChange;
}

describe('OpponentPicker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockResolvedValue({ data: { data: OPPONENTS } });
  });

  it('renders fetched opponents as options', async () => {
    renderPicker();
    expect(await screen.findByRole('option', { name: 'FC Alpha' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'FC Beta' })).toBeInTheDocument();
  });

  it('selecting an existing opponent fires onChange with its id and name', async () => {
    const onChange = renderPicker();
    await screen.findByRole('option', { name: 'FC Alpha' });
    fireEvent.change(screen.getByLabelText('Opponent'), { target: { value: 'opp-1' } });
    expect(onChange).toHaveBeenCalledWith('opp-1', 'FC Alpha');
  });

  it('the add-new flow posts and selects the created opponent', async () => {
    mockPost.mockResolvedValue({ data: { data: { opponentId: 'opp-new', name: 'New Town FC' } } });
    const onChange = renderPicker();
    await screen.findByRole('option', { name: 'FC Alpha' });

    // Switch into "add new" mode.
    fireEvent.change(screen.getByLabelText('Opponent'), { target: { value: '__add_new__' } });
    fireEvent.change(screen.getByPlaceholderText('New opponent name'), { target: { value: 'New Town FC' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/opponents', { name: 'New Town FC' }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('opp-new', 'New Town FC'));
  });
});
