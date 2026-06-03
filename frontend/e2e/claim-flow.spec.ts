import { test, expect } from '@playwright/test';
import { loginAs, TEST_USERS } from './helpers/auth';

const base = process.env.VITE_API_URL || 'http://127.0.0.1:3001';

// End-to-end of the open-spot claim flow: a published match has a free spot, an
// unselected player claims it from their dashboard, and the coach confirms the
// claim on the selections page.
test.describe('Open-spot claim flow', () => {
  test('player claims an open spot and the coach confirms it', async ({ page }) => {
    // Unique marker so we can find this exact match among any others on the dashboard.
    const opponent = `E2EClaim${Date.now()}`;

    // ── Setup via API: a published match with one filler selected (the admin),
    //    leaving the e2e player unselected and a spot open. ──────────────────────
    await loginAs(page, 'coach');
    const coachToken = await page.evaluate(() => localStorage.getItem('accessToken'));

    const matchRes = await page.request.post(`${base}/api/matches`, {
      headers: { Authorization: `Bearer ${coachToken}`, 'Content-Type': 'application/json' },
      data: JSON.stringify({
        matchDate:       '2030-10-01',
        matchTime:       '18:00',
        location:        'E2E Claim Pitch',
        opponent,
        matchType:       '7-player',
        minPlayers:      1,
        maxPlayers:      7,
        signupOpenDate:  new Date(Date.now() - 86_400_000).toISOString(),
        signupCloseDate: new Date(Date.now() + 86_400_000).toISOString(),
      }),
    });
    const matchId = (await matchRes.json()).data.matchId;

    // Admin signs up and is selected as the filler so the match can be published.
    const adminLogin = await (await page.request.post(`${base}/api/auth/login`, {
      headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify({ email: TEST_USERS.admin.email, password: TEST_USERS.admin.password }),
    })).json();
    const adminToken = adminLogin.data.tokens.accessToken;
    const adminId    = adminLogin.data.user.userId;

    await page.request.post(`${base}/api/signups`, {
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      data: JSON.stringify({ matchId }),
    });
    await page.request.put(`${base}/api/matches/${matchId}/selections`, {
      headers: { Authorization: `Bearer ${coachToken}`, 'Content-Type': 'application/json' },
      data: JSON.stringify({ selectedPlayerIds: [adminId] }),
    });
    await page.request.post(`${base}/api/matches/${matchId}/publish`, {
      headers: { Authorization: `Bearer ${coachToken}`, 'Content-Type': 'application/json' },
    });

    // ── Player claims the open spot from their dashboard. ───────────────────────
    await loginAs(page, 'player');
    await page.goto('/dashboard');

    const card = page.locator('div.bg-white.rounded-xl.border', { hasText: opponent }).first();
    const claimButton = card.getByRole('button', { name: /claim spot/i });
    await expect(claimButton).toBeVisible({ timeout: 8_000 });
    await claimButton.click();

    await expect(card.getByText(/waiting for the coach to confirm/i)).toBeVisible({ timeout: 8_000 });

    // ── Coach confirms the claim on the selections page. ────────────────────────
    await loginAs(page, 'coach');
    await page.goto(`/coach/matches/${matchId}/selections`);

    await expect(page.getByRole('heading', { name: /spot claimants/i })).toBeVisible({ timeout: 8_000 });
    await page.getByRole('button', { name: /^confirm$/i }).first().click();

    // Only claimant resolved → the claimants panel disappears.
    await expect(page.getByRole('heading', { name: /spot claimants/i })).toBeHidden({ timeout: 8_000 });
  });
});
