import { describe, it, expect } from 'vitest';
import { fetchAll } from '../src/lib/supabase.js';

// PostgREST silently stops at 1000 rows; fetchAll keeps asking until a short page.
describe('fetchAll', () => {
  const table = Array.from({ length: 25 }, (_, i) => i);
  const pager = (calls: Array<[number, number]>) => (from: number, to: number) => {
    calls.push([from, to]);
    return Promise.resolve({ data: table.slice(from, to + 1), error: null });
  };

  it('reads past the page size', async () => {
    const calls: Array<[number, number]> = [];
    const { data } = await fetchAll(pager(calls), 10);
    expect(data).toEqual(table);
    expect(calls).toEqual([[0, 9], [10, 19], [20, 29]]);
  });

  it('asks once more when the last page is exactly full', async () => {
    const calls: Array<[number, number]> = [];
    const { data } = await fetchAll(pager(calls), 5);
    expect(data).toHaveLength(25);
    expect(calls).toHaveLength(6); // five full pages, then an empty one
  });

  it('throws instead of returning a partial list', async () => {
    const failing = (from: number) => Promise.resolve(
      from === 0 ? { data: [1, 2], error: null } : { data: null, error: new Error('boom') },
    );
    await expect(fetchAll(failing, 2)).rejects.toThrow('boom');
  });
});
