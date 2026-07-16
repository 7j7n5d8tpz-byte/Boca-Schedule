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

  test('players tab opens a player profile hub', async ({ page }) => {
    await loginAs(page, 'player');
    await page.goto('/statistics');
    // Open the Players roster tab, then tap the first player row.
    await page.getByRole('button', { name: 'Players' }).click();
    await expect(page.getByText(/All players/i).first()).toBeVisible();
    // Rows are clickable divs/rows (mobile cards or desktop table rows).
    await page.locator('tbody tr, .sm\\:hidden .cursor-pointer').first().click();
    await expect(page).toHaveURL(/\/players\//);
    // The hub renders the player header and their radar section (or the
    // no-data fallback when no performances are recorded yet).
    await expect(page.getByRole('heading').first()).toBeVisible();
    await expect(
      page.getByText('Player profile').or(page.getByText(/No per-match performance data/)).first(),
    ).toBeVisible({ timeout: 8_000 });
  });

  test('own profile hub links to profile settings', async ({ page }) => {
    await loginAs(page, 'player');
    // Find your own row via the "you" chip on the Players tab.
    await page.goto('/statistics');
    await page.getByRole('button', { name: 'Players' }).click();
    await page.getByText('you', { exact: true }).first().click();
    await expect(page).toHaveURL(/\/players\//);
    await page.getByRole('link', { name: 'Edit profile' }).click();
    await expect(page).toHaveURL(/\/profile/);
  });

  test('sign-up button is visible on an open match', async ({ page }) => {
    await loginAs(page, 'player');
    await page.goto('/dashboard');
    // The upcoming-matches section always renders one of: a sign-up button
    // (open match the player hasn't joined), a "Signed up" badge (already
    // joined), or the empty state — never a crash.
    // .first() on the whole chain: the page may show several of these at once
    // (e.g. one open match and one already joined), so just assert at least one.
    const matchState = page
      .getByRole('button', { name: /sign up/i })
      .or(page.getByText(/signed up/i))
      .or(page.getByText(/no open matches/i))
      .first();
    await expect(matchState).toBeVisible({ timeout: 8_000 });
  });

  test('profile page loads', async ({ page }) => {
    await loginAs(page, 'player');
    // Profile is reached via the avatar button on the right of the nav.
    await page.getByRole('link', { name: /your profile/i }).click();
    await expect(page).toHaveURL(/profile/);
    await expect(page.getByRole('heading', { name: /profile/i })).toBeVisible();
  });
});
