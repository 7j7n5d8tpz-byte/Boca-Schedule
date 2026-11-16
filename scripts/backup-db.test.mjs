import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const script = fileURLToPath(new URL('./backup-db.sh', import.meta.url));

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  assert.ifError(result.error);
  return result;
}

function checked(command, args, options) {
  const result = run(command, args, options);
  assert.equal(result.status, 0, result.stderr);
  return result;
}

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'boca-backup-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const remote = join(dir, 'remote.git');
  const seed = join(dir, 'seed');
  checked('git', ['init', '--quiet', '--bare', '--initial-branch=main', remote]);
  checked('git', ['init', '--quiet', '--initial-branch=main', seed]);
  checked('git', ['-C', seed, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid',
    'commit', '--quiet', '--allow-empty', '-m', 'Initialize test repository']);
  checked('git', ['-C', seed, 'push', '--quiet', remote, 'main']);
  const initial = checked('git', ['--git-dir', remote, 'rev-parse', 'main']).stdout.trim();
  const key = join(dir, 'test.key');
  const keygen = checked('age-keygen', ['-o', key]);
  const recipient = /Public key: (age1\S+)/.exec(keygen.stderr)?.[1];
  assert.ok(recipient, 'age-keygen must report a public recipient');

  const bin = join(dir, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'supabase'), `#!/usr/bin/env node
const { writeFileSync } = require('node:fs');
const args = process.argv.slice(2);
if (process.env.DUMP_CASE === 'dump-failure') process.exit(23);
let content;
if (args.includes('--role-only')) {
  content = '-- stock roles\\n';
} else if (args.includes('supabase_migrations')) {
  content = args.includes('--data-only')
    ? 'COPY "supabase_migrations"."schema_migrations" (version) FROM stdin;\\n20261117000001\\n\\\\.\\n'
    : 'CREATE TABLE "supabase_migrations"."schema_migrations" (version text);\\n';
  if (process.env.DUMP_CASE === 'missing-history') content = '';
} else if (args.includes('--data-only')) {
  for (const table of ['storage.buckets_vectors', 'storage.vector_indexes']) {
    if (!args.some((arg, i) => arg === '--exclude' && args[i + 1] === table)) {
      console.error('Managed vector table was not excluded: ' + table);
      process.exit(24);
    }
  }
  content = ['"public"."users"', '"public"."matches"', '"auth"."users"'].map(table =>
    'COPY ' + table + ' (id) FROM stdin;\\n'
    + (process.env.DUMP_CASE === 'empty' ? '' : 'restorable-test-row\\n')
    + '\\\\.\\n').join('');
  if (process.env.DUMP_CASE === 'truncated') {
    content = content.slice(0, content.indexOf('COPY "auth"."users"'))
      + 'COPY "auth"."users" (id) FROM stdin;';
  }
} else {
  content = 'CREATE TABLE "public"."users" (id text);\\n';
}
writeFileSync(args[args.indexOf('-f') + 1], content);
`, { mode: 0o700 });

  const env = {
    ...process.env,
    PATH: `${bin}${delimiter}${process.env.PATH}`,
    AGE_RECIPIENT: recipient,
    BACKUP_REPO: 'local/test',
    BACKUP_DEPLOY_KEY: 'unused-local-test-key',
    BACKUP_DUMP_FROM: '--local',
    BACKUP_REMOTE: remote,
    DUMP_CASE: 'valid',
  };
  return {
    dir, remote, key, initial,
    backup: (overrides = {}) => run('bash', [script, 'manual'], { env: { ...env, ...overrides } }),
    head: () => checked('git', ['--git-dir', remote, 'rev-parse', 'main']).stdout.trim(),
  };
}

test('stores an encrypted archive with app, Auth and migration-history files', (t) => {
  const f = fixture(t);
  const result = f.backup();
  assert.equal(result.status, 0, result.stderr);
  assert.notEqual(f.head(), f.initial);
  const files = checked('git', ['--git-dir', f.remote, 'ls-tree', '-r', '--name-only', 'main'])
    .stdout.trim().split('\n');
  assert.equal(files.length, 1, 'No plaintext SQL or keys should be committed');
  assert.match(files[0], /^dumps\/\d{4}-\d\d-\d\dT\d{6}Z-manual\.tar\.gz\.age$/);
  const encrypted = checked('git', ['--git-dir', f.remote, 'show', `main:${files[0]}`],
    { encoding: 'buffer' }).stdout;
  assert.ok(encrypted.subarray(0, 30).toString().startsWith('age-encryption.org/v1'));
  const archive = join(f.dir, 'restored.tar.gz');
  checked('age', ['-d', '-i', f.key, '-o', archive], { input: encrypted });
  const names = checked('tar', ['-tzf', archive]).stdout.trim().split('\n').sort();
  assert.deepEqual(names, ['data.sql', 'history-data.sql', 'history-schema.sql', 'roles.sql', 'schema.sql']);
  assert.match(checked('tar', ['-xOzf', archive, 'data.sql']).stdout, /"auth"\."users"/);
  assert.match(checked('tar', ['-xOzf', archive, 'history-data.sql']).stdout, /20261117000001/);
});

for (const dumpCase of ['empty', 'truncated', 'missing-history', 'dump-failure']) {
  test(`refuses ${dumpCase} dumps without pushing a backup`, (t) => {
    const f = fixture(t);
    const result = f.backup({ DUMP_CASE: dumpCase });
    assert.notEqual(result.status, 0);
    assert.equal(f.head(), f.initial);
  });
}

test('encryption failure never pushes a backup', (t) => {
  const f = fixture(t);
  const result = f.backup({ AGE_RECIPIENT: 'invalid-recipient' });
  assert.notEqual(result.status, 0);
  assert.equal(f.head(), f.initial);
});

test('a rejected push is reported as failure, not a stored backup', (t) => {
  const f = fixture(t);
  writeFileSync(join(f.remote, 'hooks', 'pre-receive'),
    '#!/bin/sh\necho "Test push rejected" >&2\nexit 1\n', { mode: 0o700 });
  const result = f.backup();
  assert.notEqual(result.status, 0);
  assert.doesNotMatch(result.stdout, /Backup stored:/);
  assert.equal(f.head(), f.initial);
});
