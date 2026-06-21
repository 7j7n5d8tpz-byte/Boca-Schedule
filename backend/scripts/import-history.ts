/**
 * Historical match importer.
 *
 * Backfills already-played matches (and one upcoming fixture) from the CSVs in
 * templates/historical-import/. Players who haven't registered yet are created
 * as PLACEHOLDER users (no auth account, is_active=false, is_placeholder=true)
 * so their goals/assists/cards/attendance count immediately; an admin later
 * merges each placeholder into the real account when the person registers.
 *
 * Usage (from the backend/ directory):
 *   npx tsx scripts/import-history.ts            # dry run: parse + validate, no DB writes, no DB reads
 *   npx tsx scripts/import-history.ts --commit   # actually write to the DB in SUPABASE_URL
 *
 * The dry run needs no env and no database — run it first to confirm every name
 * maps to a canonical player and the per-match plan looks right.
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const COMMIT = process.argv.includes('--commit');
const DATA_DIR = join(__dirname, '..', '..', 'templates', 'historical-import');

// ─── CSV parsing ─────────────────────────────────────────────────────────────
// Minimal RFC-4180 parser: handles quoted fields, embedded commas/newlines and
// doubled "" escapes (match_report cells contain newlines).
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

// ─── Name normalization ──────────────────────────────────────────────────────
const norm = (s: string) => s.trim().toLowerCase();

interface PlayerEntry { canonical: string; type: 'player' | 'guest' | 'unknown'; email: string; }

const players = load('4_Players.csv');
const nameToEntry = new Map<string, PlayerEntry>();
for (const p of players) {
  const entry: PlayerEntry = {
    canonical: p.canonical_name.trim(),
    type: (p.type.trim() || 'player') as PlayerEntry['type'],
    email: p.email.trim(),
  };
  if (entry.canonical) nameToEntry.set(norm(entry.canonical), entry);
  for (const v of p.variants_seen.split(',').map(s => s.trim()).filter(Boolean)) {
    nameToEntry.set(norm(v), entry);
  }
  // Guest with no canonical name (e.g. "Gæst") is keyed by its variant only.
  if (!entry.canonical) {
    for (const v of p.variants_seen.split(',').map(s => s.trim()).filter(Boolean)) {
      nameToEntry.set(norm(v), entry);
    }
  }
}

const unmapped = new Set<string>();
const skipped = new Set<string>();
/**
 * Resolve a raw name to its roster entry. Blank/"N/A" → null. Names typed as
 * `unknown` in 4_Players.csv (e.g. an uncertain "David?") resolve to null too,
 * so they never get a placeholder account or a stat credit.
 */
function resolve(raw: string | undefined): PlayerEntry | null {
  const r = (raw ?? '').trim();
  if (!r || r.toUpperCase() === 'N/A') return null;
  const e = nameToEntry.get(norm(r));
  if (!e) { unmapped.add(r); return null; }
  if (e.type === 'unknown') { skipped.add(r); return null; }
  return e;
}

// ─── Build the plan ──────────────────────────────────────────────────────────
const ASSESSMENT: Record<string, string> = {
  'dominated': 'dominated',
  'strong performance': 'strong_performance',
  'even game': 'even_game',
  'unlucky': 'unlucky', 'uheldig': 'unlucky',
  'tough game': 'tough_game',
  'off day': 'off_day',
};
const TYPE_MIN: Record<string, number> = { 'futsal': 5, '7-player': 7, '11-player': 11 };

interface GoalPlan { scorer: PlayerEntry | null; assister: PlayerEntry | null; }
interface MatchPlan {
  ref: string; date: string; time: string; venue: string; opponent: string;
  matchType: string; category: string; serieLetter: string;
  played: boolean; goalsFor: number; goalsAgainst: number;
  gkFirst: PlayerEntry | null; gkSecond: PlayerEntry | null; cleanSheet: boolean;
  motm: PlayerEntry | null; assessment: string | null; report: string;
  participants: { entry: PlayerEntry; yellow: boolean; red: boolean }[];
  guests: string[];
  goals: GoalPlan[];
}

const matchRows = load('1_Matches.csv');
const participantRows = load('2_Participants.csv');
const goalRows = load('3_GoalEvents.csv');

const plans: MatchPlan[] = matchRows.map(m => {
  const played = m.goals_for !== '' && m.goals_against !== '';
  const partRows = participantRows.filter(p => p.match_ref === m.match_ref);
  const participants: MatchPlan['participants'] = [];
  const guests: string[] = [];
  for (const p of partRows) {
    const e = resolve(p.player_name);
    if (!e) continue;
    if (!e.canonical) { guests.push(p.player_name.trim()); continue; } // unnamed guest → guest_players
    if (e.type === 'unknown') continue;
    participants.push({ entry: e, yellow: /true/i.test(p.yellow_card), red: /true/i.test(p.red_card) });
  }
  const goals = goalRows
    .filter(g => g.match_ref === m.match_ref)
    .map(g => ({ scorer: resolve(g.scorer), assister: resolve(g.assister) }));
  return {
    ref: m.match_ref, date: m.match_date, time: m.kickoff_time || '18:00',
    venue: m.venue, opponent: m.opponent, matchType: m.match_type || '7-player',
    category: (m.category || 'serie').toLowerCase(), serieLetter: m.serie_letter || 'A',
    played, goalsFor: Number(m.goals_for || 0), goalsAgainst: Number(m.goals_against || 0),
    gkFirst: resolve(m.gk_first_half), gkSecond: resolve(m.gk_second_half),
    cleanSheet: /true/i.test(m.clean_sheet), motm: resolve(m.man_of_match),
    assessment: ASSESSMENT[norm(m.game_assessment)] ?? null, report: m.match_report,
    participants, guests, goals,
  };
});

// ─── Report ──────────────────────────────────────────────────────────────────
function printPlan() {
  for (const p of plans) {
    const tag = p.played ? `${p.goalsFor}-${p.goalsAgainst}` : 'UPCOMING (no result)';
    console.log(`\n${p.ref}  ${p.date} ${p.time}  vs ${p.opponent || '—'}  [${tag}]`);
    console.log(`   ${p.category}${p.category === 'serie' ? '/' + p.serieLetter : ''}  ${p.matchType}  venue: ${p.venue || 'Historical'}`);
    if (p.played) {
      console.log(`   participants: ${p.participants.length}  goals: ${p.goals.length}  guests: ${p.guests.length}`);
      if (p.assessment) console.log(`   assessment: ${p.assessment}`);
      if (p.motm) console.log(`   MotM: ${p.motm.canonical}`);
      const credited = p.goals
        .map(g => `${g.scorer?.canonical ?? '?'}${g.assister ? ' (' + g.assister.canonical + ')' : ''}`)
        .join(', ');
      if (credited) console.log(`   goals: ${credited}`);
    }
  }
  const distinct = new Set<string>();
  for (const p of plans) for (const pt of p.participants) distinct.add(pt.entry.canonical);
  console.log(`\n${plans.length} matches, ${plans.filter(p => p.played).length} played, ${distinct.size} distinct players referenced.`);
  if (skipped.size) {
    console.log(`\nℹ ${skipped.size} name(s) typed 'unknown' — skipped, no account or credit: ${[...skipped].join(', ')}`);
  }
  if (unmapped.size) {
    console.log(`\n⚠ ${unmapped.size} names did not map to a roster entry (add them to 4_Players.csv):`);
    for (const n of unmapped) console.log(`   - ${n}`);
  } else {
    console.log('✓ every name maps to a canonical roster entry.');
  }
}

// ─── Commit ──────────────────────────────────────────────────────────────────
async function commit() {
  const { createClient } = await import('@supabase/supabase-js');
  const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // System actor for created_by/recorded_by/etc: first active admin.
  const { data: admin } = await db.from('users').select('user_id').eq('role', 'admin').eq('is_active', true).limit(1).maybeSingle();
  if (!admin) throw new Error('No active admin user found to attribute the import to.');
  const actor = admin.user_id as string;

  // Resolve every canonical player to a user_id, creating placeholders as needed.
  const { data: existingUsers } = await db.from('users').select('user_id, name, email');
  const byName = new Map<string, string>();
  for (const u of existingUsers ?? []) byName.set(norm(u.name), u.user_id);
  const usedEmails = new Set((existingUsers ?? []).map(u => norm(u.email)));

  const canonicals = new Set<string>();
  for (const p of plans) {
    for (const pt of p.participants) canonicals.add(pt.entry.canonical);
    for (const g of p.goals) { if (g.scorer?.canonical) canonicals.add(g.scorer.canonical); if (g.assister?.canonical) canonicals.add(g.assister.canonical); }
    if (p.gkFirst?.canonical) canonicals.add(p.gkFirst.canonical);
    if (p.gkSecond?.canonical) canonicals.add(p.gkSecond.canonical);
    if (p.motm?.canonical) canonicals.add(p.motm.canonical);
  }

  const userId = new Map<string, string>();
  for (const name of canonicals) {
    const existing = byName.get(norm(name));
    if (existing) { userId.set(name, existing); continue; }
    let slug = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '');
    let email = `placeholder.${slug}@boca.local`;
    let n = 1;
    while (usedEmails.has(norm(email))) email = `placeholder.${slug}.${++n}@boca.local`;
    usedEmails.add(norm(email));
    const { data: created, error } = await db.from('users').insert({
      name, email, role: 'player', is_active: false, is_placeholder: true, preferred_positions: [],
    }).select('user_id').single();
    if (error) throw new Error(`Create placeholder "${name}" failed: ${error.message}`);
    userId.set(name, created.user_id);
    console.log(`  + placeholder user: ${name}`);
  }
  const uid = (e: PlayerEntry | null) => (e && e.canonical ? userId.get(e.canonical) ?? null : null);

  // Opponents: find-or-create case-insensitively.
  const oppId = new Map<string, string>();
  async function resolveOpp(name: string): Promise<string | null> {
    const t = name.trim();
    if (!t) return null;
    if (oppId.has(norm(t))) return oppId.get(norm(t))!;
    const { data: found } = await db.from('opponents').select('opponent_id').ilike('name', t).maybeSingle();
    let id = found?.opponent_id;
    if (!id) {
      const { data: c, error } = await db.from('opponents').insert({ name: t, created_by: actor }).select('opponent_id').single();
      if (error) throw new Error(`Create opponent "${t}" failed: ${error.message}`);
      id = c.opponent_id;
    }
    oppId.set(norm(t), id);
    return id;
  }

  // Skip matches that already exist (same date + opponent text) to stay idempotent.
  const { data: existingMatches } = await db.from('matches').select('match_date, opponent');
  const matchKey = (d: string, o: string) => `${d}|${norm(o)}`;
  const existingKeys = new Set((existingMatches ?? []).map(m => matchKey(m.match_date, m.opponent ?? '')));

  for (const p of plans) {
    if (existingKeys.has(matchKey(p.date, p.opponent))) { console.log(`= skip ${p.ref} (already imported)`); continue; }

    const opponentId = await resolveOpp(p.opponent);
    const matchMs = new Date(`${p.date}T00:00:00Z`).getTime();
    const minPlayers = TYPE_MIN[p.matchType] ?? 7;
    const time = p.time.length === 5 ? `${p.time}:00` : p.time;

    const base = {
      match_date: p.date, match_time: time,
      location: p.venue || (p.played ? 'Historical' : 'TBD'),
      match_type: p.matchType,
      opponent: p.opponent || null, opponent_id: opponentId,
      match_category: p.category, serie_letter: p.category === 'serie' ? p.serieLetter : null,
      priority_enabled: false, created_by: actor,
    };

    let matchRow;
    if (p.played) {
      const maxPlayers = Math.max(minPlayers, p.participants.length || minPlayers);
      const { data, error } = await db.from('matches').insert({
        ...base,
        signup_open_date: new Date(matchMs - 7 * 86_400_000).toISOString(),
        signup_close_date: new Date(matchMs - 1 * 86_400_000).toISOString(),
        min_players: minPlayers, max_players: maxPlayers,
        status: 'completed', completed_at: new Date().toISOString(),
      }).select('match_id').single();
      if (error) throw new Error(`Insert match ${p.ref} failed: ${error.message}`);
      matchRow = data;
    } else {
      // Upcoming fixture: its listed participants are the assigned squad, so
      // seed them as signups + selections and publish the lineup. With no squad
      // listed, fall back to an open-signup fixture for players to join.
      const squad = p.participants.map(pt => userId.get(pt.entry.canonical)!).filter(Boolean);
      const { data, error } = await db.from('matches').insert({
        ...base,
        signup_open_date: new Date().toISOString(),
        signup_close_date: new Date(Math.max(matchMs - 86_400_000, Date.now() + 3_600_000)).toISOString(),
        min_players: minPlayers, max_players: Math.max(minPlayers, squad.length, 12),
        status: squad.length ? 'published' : 'signup_open',
        published_at: squad.length ? new Date().toISOString() : null,
      }).select('match_id').single();
      if (error) throw new Error(`Insert match ${p.ref} failed: ${error.message}`);
      if (squad.length) {
        await db.from('signups').insert(squad.map(pid => ({ match_id: data.match_id, player_id: pid })));
        await db.from('selections').insert(squad.map(pid => ({
          match_id: data.match_id, player_id: pid, selected_by_optimization: false,
          manually_adjusted: true, is_priority_selection: false, selected_by: actor,
        })));
      }
      console.log(`✓ ${p.ref} created as upcoming fixture — ${squad.length} assigned (${squad.length ? 'published lineup' : 'open signups'})`);
      continue;
    }

    const matchId = matchRow.match_id;

    // Everyone who needs a stat row: listed participants ∪ scorers/assisters ∪ GKs ∪ MotM.
    const card = new Map<string, { yellow: boolean; red: boolean }>();
    for (const pt of p.participants) card.set(pt.entry.canonical, { yellow: pt.yellow, red: pt.red });
    const credited = new Set<string>(card.keys());
    for (const g of p.goals) { if (g.scorer?.canonical) credited.add(g.scorer.canonical); if (g.assister?.canonical) credited.add(g.assister.canonical); }
    if (p.gkFirst?.canonical) credited.add(p.gkFirst.canonical);
    if (p.gkSecond?.canonical) credited.add(p.gkSecond.canonical);
    if (p.motm?.canonical) credited.add(p.motm.canonical);

    const playerIds = [...credited].map(c => userId.get(c)!).filter(Boolean);
    if (playerIds.length) {
      await db.from('signups').insert(playerIds.map(pid => ({ match_id: matchId, player_id: pid })));
      await db.from('selections').insert(playerIds.map(pid => ({
        match_id: matchId, player_id: pid, selected_by_optimization: false,
        manually_adjusted: true, is_priority_selection: false, selected_by: actor,
      })));
    }

    // Team result + per-goal scorer/assister.
    const goalEvents = p.goals.map(g => ({ scorerId: uid(g.scorer), assisterId: uid(g.assister) }));
    await db.from('match_results').insert({
      match_id: matchId, goals_for: p.goalsFor, goals_against: p.goalsAgainst,
      game_assessment: p.assessment, goal_events: goalEvents, long_read: p.report || null,
      gk_first_half: uid(p.gkFirst), gk_second_half: uid(p.gkSecond),
      recorded_by: actor,
    });

    // Per-player performance (goals/assists derived from goal events, like the wizard).
    const gkIds = new Set([uid(p.gkFirst), uid(p.gkSecond)].filter(Boolean) as string[]);
    const motmId = uid(p.motm);
    const perf = [...credited].map(c => {
      const pid = userId.get(c)!;
      return {
        match_id: matchId, player_id: pid, attended: true,
        goals: goalEvents.filter(g => g.scorerId === pid).length,
        assists: goalEvents.filter(g => g.assisterId === pid).length,
        clean_sheet: p.cleanSheet && gkIds.has(pid),
        yellow_cards: card.get(c)?.yellow ? 1 : 0,
        red_cards: card.get(c)?.red ? 1 : 0,
        man_of_match: motmId != null && pid === motmId,
        submitted_by: actor,
      };
    });
    if (perf.length) await db.from('match_performance').insert(perf);

    // Unnamed guests (no stats).
    if (p.guests.length) {
      await db.from('guest_players').insert(p.guests.map(name => ({ match_id: matchId, name, added_by: actor })));
    }

    console.log(`✓ ${p.ref} imported: ${p.goalsFor}-${p.goalsAgainst}, ${playerIds.length} players, ${goalEvents.length} goals`);
  }
  console.log('\nDone.');
}

// ─── Entry ───────────────────────────────────────────────────────────────────
printPlan();
if (!COMMIT) {
  console.log('\n(dry run — no DB changes. Re-run with --commit to write.)');
  if (unmapped.size) process.exitCode = 1;
} else if (unmapped.size) {
  console.error('\nRefusing to commit: unmapped names above. Fix 4_Players.csv first.');
  process.exit(1);
} else {
  commit().catch(err => { console.error('\nImport failed:', err.message); process.exit(1); });
}
