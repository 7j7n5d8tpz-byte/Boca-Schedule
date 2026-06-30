// One-off backfill of gamification crests + streaks from existing match history.
// Idempotent — safe to run repeatedly. Run after deploying the gamification
// migration:  tsx src/scripts/backfillAchievements.ts
import 'dotenv/config';
import { backfillAll } from '../lib/achievementsStore.js';

async function main() {
  console.log('[backfill] computing achievements for all players × seasons…');
  const { players, seasons } = await backfillAll();
  console.log(`[backfill] done — ${players} players across ${seasons} season(s).`);
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('[backfill] failed', err);
    process.exit(1);
  });
