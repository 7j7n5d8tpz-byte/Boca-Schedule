import { test, expect } from '@playwright/test';
import { loginAs, TEST_USERS } from './helpers/auth';

test.describe('Coach flow', () => {
  test('logs in and lands on the coach dashboard', async ({ page }) => {
    await loginAs(page, 'coach');
    await expect(page).toHaveURL(/coach/);
    await expect(page.getByRole('heading', { name: /matches|squad|schedule/i }).first()).toBeVisible();
  });

  test('can open the new match form', async ({ page }) => {
    await loginAs(page, 'coach');
    await page.goto('/coach');
    await page.getByRole('link', { name: /new match/i }).click();
    await expect(page).toHaveURL(/coach\/matches\/new/);
    await expect(page.getByRole('heading', { name: /new match/i })).toBeVisible();
  });

  test('creates a match and it appears in the list', async ({ page }) => {
    await loginAs(page, 'coach');
    await page.goto('/coach/matches/new');

    // Fill the form
    await page.getByLabel(/match date/i).fill('2030-08-01');
    await page.getByLabel(/time|kick.?off/i).fill('18:00');
    await page.getByLabel(/signup deadline/i).fill('2030-07-01');

    // Location picker is a dropdown — add a new venue via the "+ Add location…" flow
    await page.getByLabel(/venue/i).selectOption('__add_new__');
    await page.getByPlaceholder(/new venue name/i).fill('Test Pitch E2E');
    await page.getByRole('button', { name: /^add$/i }).click();

    await page.getByRole('button', { name: /create|save|submit/i }).click();

    // Should redirect back to coach dashboard
    await expect(page).toHaveURL(/\/coach$/);
    await expect(page.getByText(/Test Pitch E2E/i)).toBeVisible({ timeout: 8_000 });
  });

  test('can view team statistics', async ({ page }) => {
    await loginAs(page, 'coach');
    await page.getByRole('button', { name: /open menu/i }).click();
    await page.getByRole('link', { name: /team stats/i }).click();
    await expect(page).toHaveURL(/statistics/);
  });

  test('publish a match - status badge updates to published', async ({ page }) => {
    await loginAs(page, 'coach');
    const coachToken = await page.evaluate(() => localStorage.getItem('accessToken'));

    const base = process.env.VITE_API_URL || 'http://127.0.0.1:3001';

    // Create a match with minPlayers=1 so we can publish after selecting one player
    const matchRes = await page.request.post(`${base}/api/matches`, {
      headers: { Authorization: `Bearer ${coachToken}`, 'Content-Type': 'application/json' },
      data: JSON.stringify({
        matchDate:       '2030-09-01',
        matchTime:       '18:00',
        location:        'E2E Publish Pitch',
        matchType:       '7-player',
        minPlayers:      1,
        maxPlayers:      7,
        signupOpenDate:  new Date(Date.now() - 86_400_000).toISOString(),
        signupCloseDate: new Date(Date.now() + 86_400_000).toISOString(),
      }),
    });
    const matchJson = await matchRes.json();
    const matchId = matchJson.data.matchId;

    // Log in as the E2E player and sign up for the match
    const playerLoginRes = await page.request.post(`${base}/api/auth/login`, {
      headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify({ email: TEST_USERS.player.email, password: TEST_USERS.player.password }),
    });
    const playerLogin = await playerLoginRes.json();
    const playerToken = playerLogin.data.tokens.accessToken;
    const playerId    = playerLogin.data.user.userId;

    await page.request.post(`${base}/api/signups`, {
      headers: { Authorization: `Bearer ${playerToken}`, 'Content-Type': 'application/json' },
      data: JSON.stringify({ matchId }),
    });

    // Select the player so the publish threshold is met
    await page.request.put(`${base}/api/matches/${matchId}/selections`, {
      headers: { Authorization: `Bearer ${coachToken}`, 'Content-Type': 'application/json' },
      data: JSON.stringify({ selectedPlayerIds: [playerId] }),
    });

    // Navigate to the match detail page and publish via UI
    await page.goto(`/coach/matches/${matchId}`);
    await page.getByRole('button', { name: /publish/i }).click();

    // The status badge should update to "published"
    await expect(page.getByText(/published/i).first()).toBeVisible({ timeout: 10_000 });
  });
});
