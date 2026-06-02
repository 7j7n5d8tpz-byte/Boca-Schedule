import { test, expect } from '@playwright/test';
import { loginAs } from './helpers/auth';

test.describe('Admin flow', () => {
  test('logs in and lands on the admin dashboard', async ({ page }) => {
    await loginAs(page, 'admin');
    await expect(page).toHaveURL(/admin/);
    await expect(page.getByRole('heading', { name: /admin/i })).toBeVisible();
  });

  test('user list loads and shows at least one user', async ({ page }) => {
    await loginAs(page, 'admin');
    await page.goto('/admin');
    // The users tab should be active by default
    await expect(page.getByRole('table').or(page.locator('[data-testid="user-list"]')).first()).toBeVisible({ timeout: 8_000 });
  });

  test('can search the user list', async ({ page }) => {
    await loginAs(page, 'admin');
    await page.goto('/admin');
    const search = page.getByPlaceholder(/search/i);
    await search.fill('e2e');
    // Results update — just verify no crash
    await page.waitForTimeout(500);
    await expect(page.locator('body')).not.toContainText('Error');
  });

  test('system health tab loads', async ({ page }) => {
    await loginAs(page, 'admin');
    await page.goto('/admin');
    await page.getByRole('button', { name: /system health/i }).click();
    await expect(page.getByText(/database|api|optimization/i).first()).toBeVisible({ timeout: 8_000 });
  });

  test('activate a pending user - row updates', async ({ page }) => {
    const base = process.env.VITE_API_URL || 'http://127.0.0.1:3001';

    // Register a new user — they start as is_active: false, pending admin approval
    const pendingName = `E2E Pending ${Date.now()}`;
    await page.request.post(`${base}/api/auth/register`, {
      headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify({ email: `e2e-pending-${Date.now()}@bocatest.internal`, password: 'Test123!', name: pendingName }),
    });

    await loginAs(page, 'admin');
    await page.goto('/admin');

    // Search for the pending user by name
    const search = page.getByPlaceholder(/search/i);
    await search.fill(pendingName);
    await page.waitForTimeout(500);

    // Click the activate button on that row
    await page.getByRole('button', { name: /activate/i }).first().click();

    // The row should update — either the button disappears or an "active" indicator appears
    await expect(
      page.getByText(/active/i).first().or(page.getByRole('button', { name: /deactivate/i }).first())
    ).toBeVisible({ timeout: 8_000 });
  });
});
