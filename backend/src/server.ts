import 'dotenv/config';
import app from './app.js';

const PORT = parseInt(process.env.PORT || '3001', 10);

// Reminder scheduler.
//
// These three jobs used to be called "hourly" by a GitHub Actions cron, but
// GitHub drops most scheduled runs on a quiet repo: in practice they arrived
// every 4–10 hours, so the daily reminders — which only act during the 18:00
// hour, club time — were skipped on most days, and drafts opened hours late.
// The Fly machine is always on (fly.toml: auto_stop_machines = 'off'), so it
// keeps time itself. Every job stamps what it has sent, so ticking often is safe.
//
// The same queries are also what keeps the free-tier Supabase project from
// pausing after 7 idle days.
//
// shortcut: assumes ONE backend machine — two would each send the reminders;
// move this to a single scheduled machine (or claim a lock row) before scaling out.
const CRON_JOBS = ['signup-reminders', 'match-announcements', 'daily-reminders'];
const TICK_MS = 10 * 60 * 1000;
let ticking = false;

async function tick() {
  if (ticking) return; // a slow send must not overlap the next tick and mail twice
  ticking = true;
  try {
    for (const job of CRON_JOBS) {
      try {
        const res = await fetch(`http://127.0.0.1:${PORT}/api/cron/${job}`, {
          method: 'POST',
          headers: { 'x-cron-secret': process.env.CRON_SECRET! },
        });
        if (!res.ok) console.error(`[cron] ${job} → HTTP ${res.status}: ${await res.text()}`);
      } catch (err) {
        console.error(`[cron] ${job} failed:`, err);
      }
    }
  } finally {
    ticking = false;
  }
}

app.listen(PORT, () => {
  console.log(`Backend running at http://localhost:${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);

  // No secret (local dev, CI, E2E) → no scheduler; the endpoints stay callable by hand.
  if (process.env.CRON_SECRET) {
    void tick(); // straight away, so a deploy inside the 18:00 hour doesn't skip the day
    setInterval(tick, TICK_MS);
  }
});
