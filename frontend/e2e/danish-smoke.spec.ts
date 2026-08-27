import { test, expect } from '@playwright/test';

/**
 * The rest of the suite pins itself to English (see fixtures.ts) so its ~80
 * text selectors stay meaningful. This spec deliberately imports the raw
 * Playwright `test` instead, so it runs against the app's real default —
 * Danish — and would catch a missing catalog or a broken i18n init.
 *
 * It stays on the pre-auth screens on purpose: the E2E accounts are shared
 * between spec files that run in parallel, so logging in and flipping an
 * account's language here would race them. That the account's own language
 * wins after login is already proven by every other spec — they only pass
 * because the seeded accounts are English ones.
 */
test.describe('Danish by default', () => {
  test('the login screen renders in Danish for a first-time visitor', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('button', { name: 'Log ind' })).toBeVisible();
    await expect(page.getByLabel('E-mail')).toBeVisible();
    await expect(page.getByLabel('Adgangskode')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Glemt adgangskode?' })).toBeVisible();
    // A missing key renders as the key itself, so this would fail loudly.
    await expect(page.locator('body')).not.toContainText('auth.');
  });

  test('the register screen renders in Danish too', async ({ page }) => {
    await page.goto('/register');
    await expect(page.getByRole('button', { name: 'Opret konto' })).toBeVisible();
    await expect(page.getByText('Fulde navn')).toBeVisible();
    await expect(page.getByText('Foretrukne positioner')).toBeVisible();
    await expect(page.locator('body')).not.toContainText('auth.');
  });

  test('a stored English preference wins before any login', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('language', 'en'));
    await page.goto('/login');
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();
  });
});
