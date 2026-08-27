import { test, expect } from './fixtures';
import { loginAs } from './helpers/auth';

// The player hub's header packs the crest, the tier caption, the XP bar and the
// rating column into one flex row. The rating column is shrink-0, so if the tier
// caption stops truncating it pushes the rating off-screen — a phone-only break
// that the rest of the suite cannot see, since every other spec runs at desktop
// width (playwright.config.ts defines a single Desktop Chrome project).
//
// Viewport is set per-file rather than via a second Playwright project: a project
// re-runs every spec at this width, and the roster specs deliberately target
// `tbody tr`, which is `hidden sm:block` and therefore invisible below Tailwind's
// sm breakpoint (640px). See commit 3175563 for that trap in the other direction.
//
// 360px (common Android) rather than 390px (modern iPhone) because that is where
// the tier caption actually needs truncating: at 390 it fits exactly — scrollWidth
// 183 vs clientWidth 183 — so `truncate` does no work and the guard below would
// pass whether or not the class were still there. At 360 it is 182 vs 153.
test.use({ viewport: { width: 360, height: 800 } });

test.describe('Player hub on a phone', () => {
  test('own hub does not scroll sideways', async ({ page }) => {
    await loginAs(page, 'player');
    // The nav avatar goes straight to your own hub, avoiding the /statistics
    // roster whose clickable rows are the desktop-only table.
    await page.getByRole('link', { name: /your profile/i }).click();
    await expect(page).toHaveURL(/\/players\//);
    await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 8_000 });

    // Data-agnostic: holds whether or not the seeded player has any history.
    // CLAUDE.md's rule is that nothing may clip off the side on a phone.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('rank and rating share the header row without overflowing', async ({ page }) => {
    // Stubbed rather than seeded: scripts/seed-e2e-users.mjs creates users and no
    // matches, so the seeded player has no completed games, career_rating comes
    // back null and the whole block is absent — a live assertion here would pass
    // vacuously. This is a CSS test, not an API-contract test (that lives in
    // backend/tests/role.test.ts), so fixing the payload is the point: it pins the
    // widest text the row can ever hold.

    // 7 codes at champion = 42 points → "Champion rank", next rung is legend at
    // 50 → "8 XP to Legend". The lower tiers of each code inflate the earned count
    // to 28 without moving the points, since only the best tier per code scores.
    // Real catalog codes, so the crest strip below resolves them to their short
    // names — an unknown code falls back to rendering the raw code inside a w-16
    // column, which would blow out the page width for reasons unrelated to this test.
    const codes = [
      'goals_scored', 'assists_made', 'clean_sheets', 'motm_awards',
      'matches_played', 'signups_made', 'attendance_streak',
    ];
    const earned = codes.flatMap(code =>
      (['bronze', 'silver', 'gold', 'champion'] as const).map(tier => ({
        code, tier, progress: 10, earnedAt: '2026-01-01T00:00:00Z',
      })),
    );

    await page.route('**/api/players/*/achievements*', route => route.fulfill({
      json: {
        success: true,
        data: {
          player: { userId: 'stub', name: 'E2E Player', avatarUrl: null },
          seasonYear: 2026,
          earned,
          groups: codes.map(code => ({ code, value: 10, highestTier: 'champion', nextThreshold: null })),
          streaks: [],
        },
      },
    }));

    await page.route('**/api/players/*/statistics*', route => route.fulfill({
      json: {
        success: true,
        data: {
          player: { userId: 'stub', name: 'Bartholomew Fitzgerald-Smythe', preferredPositions: ['MID', 'STR'], avatarUrl: null },
          seasonStats: {
            season_year: 2025, total_team_games: 20, total_played: 18,
            total_goals: 12, total_assists: 9, total_saves: 0, total_clean_sheets: 5,
            total_man_of_match: 3, total_yellow_cards: 2, total_red_cards: 1,
            gk_appearances: 4, total_signups: 19,
            avg_rating: 7.4, career_rating: 7.6, attendance_rate: 90,
          },
          availableSeasons: [{ year: 2025, label: '2025/26' }],
          recentMatches: [],
        },
      },
    }));

    await loginAs(page, 'player');
    await page.getByRole('link', { name: /your profile/i }).click();
    await expect(page).toHaveURL(/\/players\//);

    // The career rating renders, and the tier caption is the long one we asked for.
    await expect(page.getByText('7.6')).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText('career rating')).toBeVisible();
    await expect(page.getByText(/Champion rank/)).toBeVisible();

    // The tier caption must stay on ONE line. This is the assertion that actually
    // guards the layout: `truncate` (PlayerHub.tsx) is what keeps the caption from
    // wrapping and shoving the row taller. Dropping it does NOT trigger a page
    // overflow — the text simply wraps — so a scrollWidth check alone would never
    // go red here. Measured at this viewport: 16px truncated, 32px wrapped.
    const caption = page.getByText(/rank ·/).first();
    const captionBox = await caption.boundingBox();
    expect(captionBox).not.toBeNull();
    expect(captionBox!.height).toBeLessThan(24);

    // And the caption is genuinely being clipped here, so the check above is
    // testing something. If this ever stops holding, the fixture has grown roomy
    // enough that the truncate assertion has gone vacuous — widen the text or
    // narrow the viewport rather than deleting this line.
    expect(await caption.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);

    // And the rating column must sit inside the viewport, not be pushed past its
    // edge by the caption beside it.
    const box = await page.getByText('career rating').boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
