import { Page, Locator } from '@playwright/test';

// The account menu (profile, management views, settings, log out).
//   desktop (sm and up): the avatar button in the top bar ("Open menu"),
//                        rows are role=menuitem in a popover
//   phones:              the "More" tab in the bottom bar, rows are buttons in
//                        a bottom sheet
export async function openMenu(page: Page) {
  await page.getByRole('button', { name: /open menu|^more$/i }).click();
}

export function menuItem(page: Page, name: string | RegExp): Locator {
  return page
    .getByRole('menuitem', { name })
    .or(page.getByRole('dialog').getByRole('button', { name }));
}

// Your own player hub is the first row of the menu on every layout.
export async function openOwnProfile(page: Page) {
  await openMenu(page);
  await menuItem(page, /view your profile/i).click();
}
