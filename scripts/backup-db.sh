#!/usr/bin/env bash
# Dump the production database, encrypt it, and commit it to the private
# backup repository.
#
# Why this exists: the Supabase project is on the free plan, which keeps no
# backups, while every push to main applies migrations to the only database.
# CI runs this before each migration and once a week (see
# .github/workflows/deploy.yml and backup.yml).
#
# The dump is encrypted with age to a public key; the secret key stays outside
# CI. Restore instructions: docs/database-backups.md.
#
# Usage: scripts/backup-db.sh <reason>      reason: pre-migration | weekly | manual
#
# Needs: a linked Supabase project (`supabase link`) with SUPABASE_ACCESS_TOKEN
# and SUPABASE_DB_PASSWORD set, `age` on PATH, and the variables below.
set -euo pipefail
umask 077

: "${AGE_RECIPIENT:?public age key the dump is encrypted to}"
: "${BACKUP_REPO:?owner/name of the private backup repository}"
: "${BACKUP_DEPLOY_KEY:?private half of the write deploy key for that repository}"
reason="${1:?usage: backup-db.sh <reason>}"
case "$reason" in
  pre-migration|weekly|manual) ;;
  *) echo "::error::Invalid backup reason: $reason" >&2; exit 1 ;;
esac

# Test hooks: dump a local database / push to a local repository instead.
dump_from="${BACKUP_DUMP_FROM:---linked}"
case "$dump_from" in
  --local|--linked) ;;
  *) echo "::error::BACKUP_DUMP_FROM must be --local or --linked." >&2; exit 1 ;;
esac
remote="${BACKUP_REMOTE:-git@github.com:${BACKUP_REPO}.git}"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

supabase db dump "$dump_from" --role-only -f "$work/roles.sql"
supabase db dump "$dump_from" -f "$work/schema.sql"
# These managed vector tables cannot be restored by the hosted postgres role.
supabase db dump "$dump_from" --data-only --use-copy \
  --exclude storage.buckets_vectors --exclude storage.vector_indexes -f "$work/data.sql"
# Default dumps exclude migration history. Without it, a restore would cause
# the next deploy to try applying every migration again.
supabase db dump "$dump_from" --schema supabase_migrations -f "$work/history-schema.sql"
supabase db dump "$dump_from" --schema supabase_migrations --data-only --use-copy -f "$work/history-data.sql"

# A dump that silently came out empty is worse than a failed job: it would let
# the migration go ahead on the strength of a backup that holds nothing.
# pg_dump writes a COPY block for every table, empty or not, so look for a
# first row: the line after the COPY header must not be the "\." terminator.
for table in '"public"."users"' '"public"."matches"' '"auth"."users"'; do
  if ! awk -v header="COPY ${table} " \
      'index($0, header) == 1 { if (getline > 0 && $0 != "\\." && $0 != "") rows = 1 } END { exit !rows }' "$work/data.sql"; then
    echo "::error::Backup aborted: the dump holds no rows for ${table}."
    exit 1
  fi
done
if ! grep -q 'CREATE TABLE' "$work/schema.sql"; then
  echo "::error::Backup aborted: the schema dump defines no tables."
  exit 1
fi
if ! grep -q 'CREATE TABLE.*"schema_migrations"' "$work/history-schema.sql" ||
   ! awk '/^COPY "supabase_migrations"\."schema_migrations" / { if (getline > 0 && $0 != "\\." && $0 != "") rows = 1 } END { exit !rows }' "$work/history-data.sql"; then
  echo "::error::Backup aborted: migration history is missing."
  exit 1
fi

file="$(date -u +%Y-%m-%dT%H%M%SZ)-${reason}.tar.gz.age"
tar -C "$work" -czf - roles.sql schema.sql data.sql history-schema.sql history-data.sql |
  age -r "$AGE_RECIPIENT" -o "$work/$file"

install -m 600 /dev/null "$work/deploy_key"
printf '%s\n' "$BACKUP_DEPLOY_KEY" > "$work/deploy_key"
export GIT_SSH_COMMAND="ssh -i $work/deploy_key -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new"

git clone --quiet --depth 1 "$remote" "$work/repo"
mkdir -p "$work/repo/dumps"
cp "$work/$file" "$work/repo/dumps/$file"
git -C "$work/repo" add "dumps/$file"
git -C "$work/repo" -c user.name="Boca Schedule CI" -c user.email="ci@users.noreply.github.com" \
  commit --quiet -m "Backup: ${reason} ($(date -u +%Y-%m-%d))"
git -C "$work/repo" push --quiet

# shortcut: dumps are never pruned — at well under 1 MB each (weekly plus one
# per migration) that is tens of MB a year. Add pruning when the backup
# repository nears GitHub's 1 GB soft limit.
size="$(du -h "$work/$file" | cut -f1 | tr -d '[:space:]')"
echo "Backup stored: dumps/$file ($size)"
