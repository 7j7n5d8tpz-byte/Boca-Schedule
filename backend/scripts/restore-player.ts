/**
 * Scoped single-player restore from the historical CSVs.
 *
 * Context: a player's profile was hard-deleted via DELETE /api/admin/users/:id.
 * Because signups / selections / match_performance all FK player_id with
 * ON DELETE CASCADE, every one of his stat rows was deleted with him, and the
 * scorer references inside match_results.goal_events (loose JSON, no FK) now
 * point at a user_id that no longer exists — so the UI renders "Unknown".
 *
 * The person has since re-registered (a fresh account). This script rebuilds
 * ONLY that player's history from templates/historical-import/, against the
 * matches that already exist in the DB. It touches no other player's data.
 *
 * Unlike import-history.ts (which skips already-imported matches and so would
 * restore nothing here), this re-points the existing matches.
 *
 * Usage (from backend/):
 *   npx tsx scripts/restore-player.ts                      # dry run, no DB
 *   npx tsx scripts/restore-player.ts --commit             # write to SUPABASE_URL
 *   npx tsx scripts/restore-player.ts --commit --user <id> # pin the target account
 *
 * Idempotent: re-running skips matches he already has a performance row for and
 * only fixes goal_events scorerIds that are still orphaned.
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const COMMIT = process.argv.includes('--commit');
const USER_ARG = (() => {
  const i = process.argv.indexOf('--user');
  return i >= 0 ? process.argv[i + 1] : undefined;
})();
const DATA_DIR = join(__dirname, '..', '..', 'templates', 'historical-import');
const FINES_DIR = join(__dirname, '..', '..', 'templates', 'fines-import');
// Must match import-fines.ts so its idempotency check sees our restored rows.
const IMPORT_REASON = 'Historisk bødesaldo (import)';

// The player to restore. PLAYER matches the historical CSVs (canonical_name in
// 4_Players.csv); TARGET_NAME is how his RE-REGISTERED live account is named,
// which differs from the CSV. Use --user <id> to bypass the name lookup entirely.
const PLAYER = 'Mads Emil Oxholm Iversen';
const TARGET_NAME = 'Mads Emil O. Iversen';

// ─── CSV parsing (same minimal RFC-4180 parser as import-history.ts) ──────────
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c === '\r') { /* ignore */ }
    else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift()!;
  return rows
    .filter(r => r.some(v => v.trim() !== ''))
    .map(r => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}
const load = (file: string) => parseCsv(readFileSync(join(DATA_DIR, file), 'utf8'));
const norm = (s: string) => s.trim().toLowerCase();
const isMads = (raw: string | undefined) => norm(raw ?? '') === norm(PLAYER);

// ─── Build his per-match plan from the CSVs ──────────────────────────────────
const matchRows = load('1_Matches.csv');
const participantRows = load('2_Participants.csv');
const goalRows = load('3_GoalEvents.csv');

interface PlayerMatch {
  ref: string; date: string; opponent: string;
  yellow: boolean; red: boolean;
  goals: number; assists: number; motm: boolean;
  /** 1-based goal_numbers in this match that HE scored (to fix goal_events). */
  scoredGoalNumbers: number[];
}

// Matches he played in: union of participations and goals scored/assisted.
const refsHePlayed = new Set<string>();
for (const p of participantRows) if (p.match_ref && isMads(p.player_name)) refsHePlayed.add(p.match_ref);
for (const g of goalRows) if (g.match_ref && (isMads(g.scorer) || isMads(g.assister))) refsHePlayed.add(g.match_ref);

const plan: PlayerMatch[] = [...refsHePlayed].map(ref => {
  const m = matchRows.find(r => r.match_ref === ref)!;
  const part = participantRows.find(p => p.match_ref === ref && isMads(p.player_name));
  const myGoals = goalRows.filter(g => g.match_ref === ref && isMads(g.scorer));
  const myAssists = goalRows.filter(g => g.match_ref === ref && isMads(g.assister));
  return {
    ref, date: m.match_date, opponent: m.opponent,
    yellow: /true/i.test(part?.yellow_card ?? 'false'),
    red: /true/i.test(part?.red_card ?? 'false'),
    goals: myGoals.length, assists: myAssists.length,
    motm: isMads(m.man_of_match),
    scoredGoalNumbers: myGoals.map(g => Number(g.goal_number)).filter(n => Number.isFinite(n)),
  };
}).sort((a, b) => a.date.localeCompare(b.date));

const totalGoals = plan.reduce((s, p) => s + p.goals, 0);
const totalAssists = plan.reduce((s, p) => s + p.assists, 0);

// ─── His fines position from the fines CSV ───────────────────────────────────
// balance = paid − total, so owed = −balance, paid = total + balance.
const finesCsv = parseCsv(readFileSync(join(FINES_DIR, '1_Fines.csv'), 'utf8'));
const myFine = finesCsv.find(r => isMads(r.canonical_name) || isMads(r.player_name));
const fines = myFine
  ? (() => {
      const total = Number(myFine.total_fined), balance = Number(myFine.balance);
      return { total, owed: -balance, paid: total + balance };
    })()
  : null;

function printPlan() {
  console.log(`Restore plan for: ${PLAYER}\n`);
  for (const p of plan) {
    const flags = [
      p.goals ? `${p.goals}G` : '', p.assists ? `${p.assists}A` : '',
      p.yellow ? 'YC' : '', p.red ? 'RC' : '', p.motm ? 'MotM' : '',
    ].filter(Boolean).join(' ');
    console.log(`  ${p.ref}  ${p.date}  vs ${p.opponent || '—'}   ${flags || 'played'}`);
  }
  console.log(`\n${plan.length} matches, ${totalGoals} goals, ${totalAssists} assists.`);
  if (fines) console.log(`Fines: total ${fines.total}  owed ${fines.owed}  paid ${fines.paid}`);
  else console.log('Fines: no row for him in fines-import/1_Fines.csv');
}

// ─── Commit ──────────────────────────────────────────────────────────────────
async function commit() {
  const { createClient } = await import('@supabase/supabase-js');
  const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Target account: the re-registered, active, non-placeholder Mads. Named
  // TARGET_NAME, NOT the CSV's PLAYER name.
  let targetId = USER_ARG;
  if (!targetId) {
    const { data: cands } = await db.from('users')
      .select('user_id, name, is_active, is_placeholder, merged_into')
      .ilike('name', TARGET_NAME);
    const live = (cands ?? []).filter(u => !u.is_placeholder && u.merged_into == null);
    if (live.length !== 1) {
      console.error(`\nExpected exactly one live account named "${TARGET_NAME}", found ${live.length}:`);
      for (const u of cands ?? []) console.error(`   ${u.user_id}  active=${u.is_active} placeholder=${u.is_placeholder} merged_into=${u.merged_into}`);
      console.error('Pass the right one explicitly with --user <id>.');
      process.exit(1);
    }
    targetId = live[0].user_id;
  }
  const target: string = targetId!; // guaranteed set above (else exited)
  console.log(`Target account: ${target}\n`);

  // System actor for selected_by / submitted_by: first active admin.
  const { data: admin } = await db.from('users')
    .select('user_id').eq('role', 'admin').eq('is_active', true).limit(1).maybeSingle();
  if (!admin) throw new Error('No active admin user found to attribute the restore to.');
  const actor = admin.user_id as string;
  const now = new Date().toISOString();

  // For orphan detection in goal_events: the set of all real user_ids.
  const { data: allUsers } = await db.from('users').select('user_id');
  const liveIds = new Set((allUsers ?? []).map(u => u.user_id));

  let restored = 0, skipped = 0, goalsFixed = 0;

  for (const p of plan) {
    // Find the already-existing match by date + opponent text.
    const { data: matches } = await db.from('matches')
      .select('match_id, opponent').eq('match_date', p.date);
    const match = (matches ?? []).find(m => norm(m.opponent ?? '') === norm(p.opponent));
    if (!match) { console.warn(`! ${p.ref} (${p.date} vs ${p.opponent}): no matching match in DB — skipped`); continue; }
    const matchId = match.match_id;

    // Idempotency: already restored?
    const { data: existingPerf } = await db.from('match_performance')
      .select('performance_id').eq('match_id', matchId).eq('player_id', target).maybeSingle();
    if (existingPerf) { console.log(`= ${p.ref}: performance row already present — skipped`); skipped++; }
    else {
      // signup (no unique constraint → check then insert)
      const { data: sExisting } = await db.from('signups')
        .select('signup_id').eq('match_id', matchId).eq('player_id', target).limit(1).maybeSingle();
      if (!sExisting) {
        const { error } = await db.from('signups').insert({ match_id: matchId, player_id: target });
        if (error) throw new Error(`${p.ref} signup: ${error.message}`);
      }
      // selection (UNIQUE match_id+player_id → upsert no-op on conflict)
      const { error: selErr } = await db.from('selections').upsert({
        match_id: matchId, player_id: target, selected_by_optimization: false,
        manually_adjusted: true, is_priority_selection: false, selected_by: actor,
      }, { onConflict: 'match_id,player_id', ignoreDuplicates: true });
      if (selErr) throw new Error(`${p.ref} selection: ${selErr.message}`);
      // performance
      const { error: perfErr } = await db.from('match_performance').insert({
        match_id: matchId, player_id: target, attended: true,
        goals: p.goals, assists: p.assists, clean_sheet: false,
        yellow_cards: p.yellow ? 1 : 0, red_cards: p.red ? 1 : 0,
        man_of_match: p.motm, submitted_by: actor,
      });
      if (perfErr) throw new Error(`${p.ref} performance: ${perfErr.message}`);
      console.log(`✓ ${p.ref}: restored (${p.goals}G ${p.assists}A${p.motm ? ' MotM' : ''}${p.yellow ? ' YC' : ''})`);
      restored++;
    }

    // Fix goal_events: re-point HIS scored goals from the orphaned old id to the
    // new account. Only entries at his CSV goal positions whose scorerId is now
    // orphaned (not a live user) are rewritten — everyone else's goals untouched.
    if (p.scoredGoalNumbers.length) {
      const { data: mr } = await db.from('match_results')
        .select('goal_events').eq('match_id', matchId).maybeSingle();
      const events: { scorerId: string | null; assisterId: string | null }[] = mr?.goal_events ?? [];
      let changed = false;
      for (const gn of p.scoredGoalNumbers) {
        const e = events[gn - 1];
        if (e && e.scorerId && e.scorerId !== target && !liveIds.has(e.scorerId)) {
          e.scorerId = target; changed = true; goalsFixed++;
        }
      }
      if (changed) {
        const { error } = await db.from('match_results').update({ goal_events: events }).eq('match_id', matchId);
        if (error) throw new Error(`${p.ref} goal_events: ${error.message}`);
        console.log(`  ↳ ${p.ref}: goal_events scorer(s) re-pointed`);
      }
    }
  }

  console.log(`\nMatches: ${restored} restored, ${skipped} already present, ${goalsFixed} goal scorer refs fixed.`);
  if (goalsFixed !== totalGoals) {
    console.warn(`⚠ Expected ${totalGoals} goal refs from the CSV, fixed ${goalsFixed}. ` +
      `Difference is fine if some were already correct on a prior run; investigate otherwise.`);
  }

  // ── Fines: restore his ledger, idempotent on the import-reason marker. ──
  if (fines && (fines.paid > 0 || fines.owed > 0)) {
    const { data: existingFines } = await db.from('fines')
      .select('fine_id').eq('player_id', target).eq('reason', IMPORT_REASON);
    if (existingFines && existingFines.length) {
      console.log(`Fines: already present (${existingFines.length} rows) — skipped`);
    } else {
      const rows: any[] = [];
      if (fines.paid > 0) rows.push({
        player_id: target, amount_dkk: fines.paid, reason: IMPORT_REASON, status: 'paid',
        issued_by: actor, approved_by: actor, approved_at: now,
        paid_claimed_at: now, confirmed_by: actor, confirmed_at: now,
      });
      if (fines.owed > 0) rows.push({
        player_id: target, amount_dkk: fines.owed, reason: IMPORT_REASON, status: 'approved',
        issued_by: actor, approved_by: actor, approved_at: now,
      });
      const { error } = await db.from('fines').insert(rows);
      if (error) throw new Error(`Insert fines: ${error.message}`);
      console.log(`Fines: restored ${rows.length} rows (paid ${fines.paid}, owed ${fines.owed}).`);
    }
  }
}

// ─── Entry ───────────────────────────────────────────────────────────────────
printPlan();
if (!COMMIT) {
  console.log('\n(dry run — no DB changes. Re-run with --commit to write.)');
} else {
  commit().catch(err => { console.error('\nRestore failed:', err.message); process.exit(1); });
}
