/**
 * Fines history importer.
 *
 * Backfills each player's current fines position from templates/fines-import/
 * 1_Fines.csv (player_name, canonical_name, total_fined, balance). Balance is
 * `paid − total`, so a negative balance means money owed:
 *     owed = -balance,  paid = total_fined + balance.
 *
 * Each player becomes up to two ledger fines so both the per-player balance and
 * the team pot reconcile:
 *   • a `paid`     fine for the settled portion   (amount = paid)
 *   • an `approved` fine for the outstanding part (amount = owed)
 *
 * Players without an account become PLACEHOLDER users (no auth, is_active=false,
 * is_placeholder=true), found-or-created by canonical name so they reuse the
 * placeholders already created by the match import. An admin later merges each
 * placeholder into the real account (merge now also re-points fines).
 *
 * Usage (from backend/):
 *   npx tsx scripts/import-fines.ts            # dry run: parse + validate, no DB
 *   npx tsx scripts/import-fines.ts --commit   # write to the DB in SUPABASE_URL
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const COMMIT = process.argv.includes('--commit');
const DATA_DIR = join(__dirname, '..', '..', 'templates', 'fines-import');
const IMPORT_REASON = 'Historisk bødesaldo (import)';

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let field = '', row: string[] = [], inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += c;
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

const norm = (s: string) => s.trim().toLowerCase();

interface FinePlan {
  sheetName: string;
  canonical: string;
  total: number;
  owed: number;
  paid: number;
}

const rows = parseCsv(readFileSync(join(DATA_DIR, '1_Fines.csv'), 'utf8'));
const problems: string[] = [];
const plans: FinePlan[] = rows.map(r => {
  const total = Number(r.total_fined);
  const balance = Number(r.balance);
  const owed = -balance;
  const paid = total + balance;
  if (!r.canonical_name) problems.push(`${r.player_name}: missing canonical_name`);
  if (!Number.isFinite(total) || !Number.isFinite(balance)) problems.push(`${r.player_name}: non-numeric total/balance`);
  if (owed < 0) problems.push(`${r.player_name}: positive balance (prepaid) not supported — owed<0`);
  if (paid < 0) problems.push(`${r.player_name}: balance more negative than total — paid<0`);
  return { sheetName: r.player_name, canonical: r.canonical_name, total, owed, paid };
});

function printPlan() {
  let sumOwed = 0, sumPaid = 0, sumTotal = 0, fineRows = 0;
  for (const p of plans) {
    sumOwed += p.owed; sumPaid += p.paid; sumTotal += p.total;
    fineRows += (p.paid > 0 ? 1 : 0) + (p.owed > 0 ? 1 : 0);
    const map = p.sheetName === p.canonical ? '' : `  →  ${p.canonical}`;
    console.log(`${p.sheetName}${map}   total ${p.total}  owed ${p.owed}  paid ${p.paid}`);
  }
  console.log(`\n${plans.length} players · ${fineRows} fine rows · total ${sumTotal} = outstanding ${sumOwed} + collected ${sumPaid}`);
  if (problems.length) {
    console.log(`\n⚠ ${problems.length} problem(s):`);
    for (const p of problems) console.log(`   - ${p}`);
  } else {
    console.log('✓ every row valid (owed≥0, paid≥0, owed+paid=total).');
  }
}

async function commit() {
  const { createClient } = await import('@supabase/supabase-js');
  const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: admin } = await db.from('users').select('user_id').eq('role', 'admin').eq('is_active', true).limit(1).maybeSingle();
  if (!admin) throw new Error('No active admin user found to attribute the import to.');
  const actor = admin.user_id as string;
  const now = new Date().toISOString();

  // Resolve canonical → user_id, creating placeholders as needed (reusing the
  // ones the match import already made, matched case-insensitively by name).
  // If a user is a merged tombstone, follow merged_into to the real account so
  // fines are never created against a dead UUID.
  const { data: existingUsers } = await db.from('users').select('user_id, name, email, merged_into');
  const byName = new Map<string, string>();
  for (const u of existingUsers ?? []) byName.set(norm(u.name), u.merged_into ?? u.user_id);
  const usedEmails = new Set((existingUsers ?? []).map(u => norm(u.email)));

  const userId = new Map<string, string>();
  for (const name of new Set(plans.map(p => p.canonical))) {
    const existing = byName.get(norm(name));
    if (existing) { userId.set(name, existing); continue; }
    let slug = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '');
    let email = `placeholder.${slug}@boca.local`, n = 1;
    while (usedEmails.has(norm(email))) email = `placeholder.${slug}.${++n}@boca.local`;
    usedEmails.add(norm(email));
    const { data: created, error } = await db.from('users').insert({
      name, email, role: 'player', is_active: false, is_placeholder: true, preferred_positions: [],
    }).select('user_id').single();
    if (error) throw new Error(`Create placeholder "${name}" failed: ${error.message}`);
    userId.set(name, created.user_id);
    console.log(`  + placeholder user: ${name}`);
  }

  // Idempotency: skip players who already carry an imported balance fine.
  const playerIds = [...new Set(plans.map(p => userId.get(p.canonical)!))];
  const { data: already } = await db.from('fines').select('player_id').eq('reason', IMPORT_REASON).in('player_id', playerIds);
  const alreadyImported = new Set((already ?? []).map((f: any) => f.player_id));

  const toInsert: any[] = [];
  for (const p of plans) {
    const pid = userId.get(p.canonical)!;
    if (alreadyImported.has(pid)) { console.log(`= skip ${p.canonical} (already imported)`); continue; }
    if (p.paid > 0) toInsert.push({
      player_id: pid, amount_dkk: p.paid, reason: IMPORT_REASON, status: 'paid',
      issued_by: actor, approved_by: actor, approved_at: now,
      paid_claimed_at: now, confirmed_by: actor, confirmed_at: now,
    });
    if (p.owed > 0) toInsert.push({
      player_id: pid, amount_dkk: p.owed, reason: IMPORT_REASON, status: 'approved',
      issued_by: actor, approved_by: actor, approved_at: now,
    });
  }

  if (toInsert.length) {
    const { error } = await db.from('fines').insert(toInsert);
    if (error) throw new Error(`Insert fines failed: ${error.message}`);
  }
  console.log(`\nDone. Inserted ${toInsert.length} fine rows.`);
}

printPlan();
if (!COMMIT) {
  console.log('\n(dry run — no DB changes. Re-run with --commit to write.)');
  if (problems.length) process.exitCode = 1;
} else if (problems.length) {
  console.error('\nRefusing to commit: fix the problems above first.');
  process.exit(1);
} else {
  commit().catch(err => { console.error('\nImport failed:', err.message); process.exit(1); });
}
