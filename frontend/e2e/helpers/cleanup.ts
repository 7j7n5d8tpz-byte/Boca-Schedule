import { type APIRequestContext } from '@playwright/test';

const API = process.env.VITE_API_URL || 'http://127.0.0.1:3001';

/**
 * Remove every match at a test venue, and the venue itself.
 *
 * Matches have no delete endpoint — cancelling is the removal path, and both
 * the coach dashboard and the player home hide cancelled matches. That is what
 * matters here: the specs create fixtures at fixed venues on fixed dates, so
 * without cleanup a second run finds the match it just created *and* the ones
 * earlier runs left behind — a strict-mode violation for any locator matching
 * on the venue, and published fixtures cluttering the dashboard in between.
 * CI starts from an empty DB; this keeps repeated local runs green too.
 *
 * Call it before creating as well as after: a run that fails midway never
 * reaches its own cleanup, and the next one should still start clean.
 */
export async function clearVenue(request: APIRequestContext, token: string | null, venue: string) {
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  // status=all is the coach view, which already excludes cancelled matches.
  const res = await request.get(`${API}/api/matches/upcoming?status=all&limit=200`, { headers });
  const body = await res.json().catch(() => null);
  const stale = (body?.data?.matches ?? []).filter((m: { location: string }) => m.location === venue);

  for (const m of stale) {
    await request.put(`${API}/api/matches/${m.matchId}`, {
      headers,
      data: JSON.stringify({ status: 'cancelled' }),
    });
  }

  // Drop it from the venue picker too, so the dropdown doesn't collect test
  // entries. A no-op for venues that were never added to the list.
  await request.delete(`${API}/api/locations`, { headers, data: JSON.stringify({ name: venue }) });
}

/**
 * Void every fine whose reason starts with the given marker prefix.
 *
 * Same shape as clearVenue: fines have no delete endpoint either, and voided
 * fines drop out of the ledger, the team stats and the admin queues. The token
 * must belong to a fine admin. Needs both a before and an after call for the
 * same reason — a run that fails midway leaves its fine on the books, where it
 * would otherwise sit in every player's transparency table for good.
 */
export async function clearFines(request: APIRequestContext, token: string | null, markerPrefix: string) {
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  // Lists approved/claimed/paid fines — every state a test fine can reach.
  const res = await request.get(`${API}/api/fines`, { headers });
  const body = await res.json().catch(() => null);
  const stale = (body?.data ?? []).filter((f: { reason: string | null }) => (f.reason ?? '').startsWith(markerPrefix));

  for (const f of stale) {
    await request.put(`${API}/api/fines/${f.fineId}/void`, {
      headers,
      data: JSON.stringify({ reason: 'E2E cleanup' }),
    });
  }
}
