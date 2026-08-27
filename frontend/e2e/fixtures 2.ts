import { test as base, expect } from '@playwright/test';

/**
 * Playwright `test`, pinned to the English UI.
 *
 * The app defaults to Danish, but these specs locate almost every element by
 * its English label. Seeding the language before the page's first script runs
 * keeps those selectors meaningful and means a Danish copy change can't break
 * an assertion that was never about the copy. `danish-smoke.spec.ts` imports
 * the raw `@playwright/test` instead, so the Danish default still gets covered.
 */
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.addInitScript(() => {
      try { window.localStorage.setItem('language', 'en'); } catch { /* ignore */ }
    });
    await use(page);
  },
});

export { expect };
