import { test, expect } from '@playwright/test';
import { loginAs } from './helpers/auth';

test.describe('Player flow', () => {
  test('logs in and sees the dashboard', async ({ page }) => {
    await loginAs(page, 'player');
    await expect(page).toHaveURL(/dashboard/);
    await expect(page.getByRole('heading', { name: /welcome/i })).toBeVisible();
  });

  test('can navigate to team statistics', async ({ page }) => {
    await loginAs(page, 'player');
    // Open hamburger menu
    await page.getByRole('button', { name: /open menu/i }).click();
    await page.getByRole('link', { name: /team stats/i }).click();
    await expect(page).toHaveURL(/statistics/);
    // Stats page should render without error
    await expect(page.getByRole('heading', { name: /team|statistics|season/i }).first()).toBeVisible();
  });

  test('sign-up button is visible on an open match', async ({ page }) => {
    await loginAs(page, 'player');
    await page.goto('/dashboard');
    // If any open match exists, the sign-up button should be present
    const signupBtn = page.getByRole('button', { name: /sign up/i }).first();
    const noMatches = page.getByText(/no upcoming matches/i);
    // Either a sign-up button or the empty state is shown — never a crash
    await expect(signupBtn.or(noMatches)).toBeVisible({ timeout: 8_000 });
  });

  test('profile page loads', async ({ page }) => {
    await loginAs(page, 'player');
    await page.getByRole('button', { name: /open menu/i }).click();
    // Click user name (links to profile)
    await page.getByRole('link', { name: /e2e-player|test player/i }).first().click();
    await expect(page).toHaveURL(/profile/);
    await expect(page.getByRole('heading', { name: /profile/i })).toBeVisible();
  });
});
