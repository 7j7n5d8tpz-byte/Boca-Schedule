import { test, expect } from '@playwright/test';
import { loginAs, TEST_USERS } from './helpers/auth';

const base = process.env.VITE_API_URL || 'http://127.0.0.1:3001';

// End-to-end of the fines flow: a fine admin issues a fine, the fined player
// pays it from the Fines page, and the admin confirms the payment on the
// Manage-fines page.
test.describe('Fines flow', () => {
  test('admin issues a fine, player pays, admin confirms', async ({ page }) => {
    const marker = `E2EFine${Date.now()}`; // unique reason so we can find this exact fine
    const amount = 42;

    // ── Setup via API: log in player (for id) + admin (for token), issue an
    //    auto-approved custom fine to the player. ────────────────────────────────
    const playerLogin = await (await page.request.post(`${base}/api/auth/login`, {
      headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify({ email: TEST_USERS.player.email, password: TEST_USERS.player.password }),
    })).json();
    const playerId = playerLogin.data.user.userId;

    const adminLogin = await (await page.request.post(`${base}/api/auth/login`, {
      headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify({ email: TEST_USERS.admin.email, password: TEST_USERS.admin.password }),
    })).json();
    const adminToken = adminLogin.data.tokens.accessToken;

    const issue = await page.request.post(`${base}/api/fines`, {
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      data: JSON.stringify({ playerId, amountDkk: amount, reason: marker }),
    });
    expect(issue.ok()).toBeTruthy();
    expect((await issue.json()).data.status).toBe('approved');

    // ── Player pays the fine from the Fines page. ───────────────────────────────
    await loginAs(page, 'player');
    await page.goto('/fines');

    const row = page.locator('tr', { hasText: marker });
    await expect(row).toBeVisible({ timeout: 8_000 });
    await expect(row).toContainText('Outstanding');

    await page.getByRole('button', { name: "I've paid" }).click();
    await expect(page.getByRole('heading', { name: /confirm payment/i })).toBeVisible({ timeout: 8_000 });
    await page.getByRole('button', { name: /yes, i've paid/i }).click();

    // The fine moves to "Awaiting confirm".
    await expect(page.locator('tr', { hasText: marker })).toContainText('Awaiting confirm', { timeout: 8_000 });

    // ── Admin confirms the payment on the Manage-fines page. ────────────────────
    await loginAs(page, 'admin');
    await page.goto('/fines/manage');

    const claimRow = page.locator('div.py-3', { hasText: marker });
    await expect(claimRow).toBeVisible({ timeout: 8_000 });
    await claimRow.getByRole('button', { name: /^confirm$/i }).click();

    // Confirmed → the fine leaves the "payments to confirm" queue.
    await expect(page.getByText(marker)).toHaveCount(0, { timeout: 8_000 });
  });
});
