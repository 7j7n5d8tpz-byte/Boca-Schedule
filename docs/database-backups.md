# Database backups

The private [backup repository](https://github.com/7j7n5d8tpz-byte/boca-schedule-backups)
holds encrypted logical dumps produced by [backup-db.sh](../scripts/backup-db.sh).
The workflows become active once merged to `main`:

- [Deploy](../.github/workflows/deploy.yml) backs up before pending migrations.
  A failed dry run, dump, encryption or backup push stops the migration.
- [Database backup](../.github/workflows/backup.yml) runs Mondays at 03:00 UTC
  and supports **Run workflow** for manual backups. Scheduled runs can be late.
- Both jobs share a concurrency group so they do not push backups simultaneously.

CI needs the existing `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD` and
`SUPABASE_PROJECT_REF` secrets, plus `BACKUP_DEPLOY_KEY`, an SSH deploy key with
write access only to the private backup repository. This key is unrelated to the
age decryption key. GitHub deploy keys allow reads as well as writes; CI has no
age secret key and cannot decrypt the dumps.

Files are named `dumps/<UTC time>-<pre-migration|weekly|manual>.tar.gz.age`.
Each archive contains:

- `roles.sql`: role definitions/settings, without login passwords.
- `schema.sql`: application schema, functions, policies and grants.
- `data.sql`: application, Auth and supported Storage metadata.
- `history-schema.sql`, `history-data.sql`: Supabase migration history, so a
  restored database does not run old migrations again.

The script refuses dumps without users, login accounts, matches or migration
history. This is a guard for this populated app, not a generic empty-project
backup utility. Dumps are kept indefinitely; monitor repository size.

## Coverage and limitations

Storage file contents (including avatars), managed Storage vector metadata,
extension-owned job schedules, project settings, API keys and external service
secrets are not backed up.
Recreate the project's configuration and required extensions when restoring
to a new project. Writes after the last dump are lost. These are logical dumps,
not point-in-time recovery; avoid concurrent schema changes while dumping.

Encryption uses the public age recipient configured in both workflows. Keep its
matching secret key in a password manager, outside CI and git. **Losing that key
makes every backup unreadable.** Check failed backup jobs and periodically
repeat the local restore drill.

## Restore drill

Never restore directly over production. Use a fresh Supabase project, or a fresh
local Supabase stack **without this app's migrations already applied**. Its
managed `auth` and `storage` schemas should exist, but its app tables and
`supabase_migrations` history should be empty.

1. In a private working directory, save the age secret key as `boca-backup.key`
   with permissions `600`. Decrypt and extract a chosen dump:

   ```sh
   umask 077
   set -o pipefail
   age -d -i boca-backup.key dumps/<file>.tar.gz.age | tar xz
   ```

2. On a new hosted project, review `roles.sql` before applying custom roles or
   settings. Stock Supabase roles already exist. A local dump can contain
   managed-role grants such as `GRANT SET ON PARAMETER "log_min_messages"` that
   the hosted `postgres` role cannot apply. Do not ignore restore errors or
   grant elevated permissions just to bypass them.

   This app uses stock Supabase roles. Restore the app, Auth, supported Storage
   metadata and migration history together using the target connection string:

   ```sh
   psql --single-transaction --variable ON_ERROR_STOP=1 \
     --file schema.sql --file history-schema.sql \
     --command 'SET session_replication_role = replica' \
     --file data.sql --file history-data.sql \
     --dbname "$TARGET_DATABASE_URL"
   ```

   For a local drill, mount/copy the extracted SQL files into the fresh stack's
   database container, then run the same restore as its `postgres` role:

   ```sh
   docker exec <fresh-db-container> psql -U postgres -d postgres \
     --single-transaction --variable ON_ERROR_STOP=1 \
     --file /tmp/schema.sql --file /tmp/history-schema.sql \
     --command 'SET session_replication_role = replica' \
     --file /tmp/data.sql --file /tmp/history-data.sql
   ```

3. Recreate this app's three `pg_cron` maintenance jobs by running these
   idempotent migrations against the restored target (not the whole migration
   directory):

   - [20260610000001_prune_audit_log.sql](../supabase/migrations/20260610000001_prune_audit_log.sql)
   - [20260625000003_prune_notifications_and_spot_claims.sql](../supabase/migrations/20260625000003_prune_notifications_and_spot_claims.sql)

   For a hosted target, pass each file to `psql --variable ON_ERROR_STOP=1
   --dbname "$TARGET_DATABASE_URL" --file <file>`. For a local target, pipe each
   file into `docker exec -i <fresh-db-container> psql -U postgres -d postgres
   --variable ON_ERROR_STOP=1`. Verify the three named jobs in `cron.job`.

4. Check row counts, RLS policies, service-role grants and migration versions.
   Test signing in with a restored test account's existing password. Confirm
   `supabase db push --local --dry-run` (using the restored local stack's
   workdir and this app's migration files) reports the database is up to date.
   A successful decrypt alone is not a successful restore.
5. Remove the extracted SQL, copied container files and temporary key file.
   Stop and remove the disposable local stack when finished.

For individual rows, restore locally first and copy only the needed rows back.

## Focused regression tests

With Node.js, git, tar and age installed, run:

```sh
node --test scripts/backup-db.test.mjs
```

These use synthetic dumps and temporary local repositories, never production.
Both backup jobs run them before connecting to the hosted project.
