// Backfill of gamification crests + streaks from existing match history.
// Idempotent — safe to run repeatedly:  tsx src/scripts/backfillAchievements.ts
//
// Reconciling, not just additive: it also revokes persisted crests a player no
// longer qualifies for. Re-run it after any change to the award rules so the
// team wall (which reads persisted rows) matches what the engine now computes.
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
