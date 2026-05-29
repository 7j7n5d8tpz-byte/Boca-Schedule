import { Page } from '@playwright/test';

export const TEST_USERS = {
  player: {
    email:    process.env.E2E_PLAYER_EMAIL    || 'e2e-player@bocatest.internal',
    password: process.env.E2E_PLAYER_PASSWORD || 'Test123!',
  },
  coach: {
    email:    process.env.E2E_COACH_EMAIL    || 'e2e-coach@bocatest.internal',
    password: process.env.E2E_COACH_PASSWORD || 'Test123!',
  },
  admin: {
    email:    process.env.E2E_ADMIN_EMAIL    || 'e2e-admin@bocatest.internal',
    password: process.env.E2E_ADMIN_PASSWORD || 'Test123!',
  },
};

export async function loginAs(page: Page, role: keyof typeof TEST_USERS) {
  const { email, password } = TEST_USERS[role];
  await page.goto('/login');
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole('button', { name: /sign in|log in/i }).click();
  // Wait for redirect away from login
  await page.waitForURL(url => !url.pathname.includes('/login'), { timeout: 10_000 });
}
