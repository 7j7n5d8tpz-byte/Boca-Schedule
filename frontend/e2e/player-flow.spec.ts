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
    // Open the Players roster tab, then click the first player row. The tests
    // run on a desktop viewport, so target the table rows — the stacked
    // mobile cards are in the DOM but hidden (sm:hidden).
    await page.getByRole('button', { name: 'Players' }).click();
    await page.locator('tbody tr').first().click();
    await expect(page).toHaveURL(/\/players\//);
    // The hub renders the player header and their radar section (or the
    // no-data fallback when no performances are recorded yet).
    await expect(page.getByRole('heading').first()).toBeVisible();
    await expect(
      page.getByText('Play style').or(page.getByText(/No per-match performance data/)).first(),
    ).toBeVisible({ timeout: 8_000 });
  });

  test('own profile hub links to settings', async ({ page }) => {
    await loginAs(page, 'player');
    // Find your own (visible, desktop) row via the "you" chip on the Players tab.
    await page.goto('/statistics');
    await page.getByRole('button', { name: 'Players' }).click();
    await page
      .locator('tbody tr')
      .filter({ has: page.getByText('you', { exact: true }) })
      .first()
      .click();
    await expect(page).toHaveURL(/\/players\//);
    await page.getByRole('link', { name: 'Edit profile' }).click();
    await expect(page).toHaveURL(/\/settings/);
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

  test('nav avatar opens your hub; settings load from the menu', async ({ page }) => {
    await loginAs(page, 'player');
    // The avatar button on the right of the nav opens your own player hub.
    await page.getByRole('link', { name: /your profile/i }).click();
    await expect(page).toHaveURL(/\/players\//);
    // Account settings live in the drawer menu footer.
    await page.getByRole('button', { name: /open menu/i }).click();
    await page.getByRole('link', { name: 'Settings' }).click();
    await expect(page).toHaveURL(/\/settings/);
    await expect(page.getByRole('heading', { name: /settings/i })).toBeVisible();
  });
});
