import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

async function setup(t) {
  const dir = await mkdtemp(join(tmpdir(), 'c46-backup-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, 'app.env'), 'DB_USERNAME=test\nDB_NAME=test\n');
  await writeFile(
    join(dir, 'docker'),
    `#!/bin/sh
printf '%s\\n' "$*" >> "$DOCKER_CALLS"
case "$*" in
  *pg_dump*) printf 'test dump'; exit "\${DUMP_EXIT:-0}" ;;
  *pg_isready*) exit "\${READY_EXIT:-0}" ;;
  *pg_restore*) exit "\${RESTORE_EXIT:-0}" ;;
  *psql*) exit "\${SCHEMA_EXIT:-0}" ;;
esac
`,
    { mode: 0o700 },
  );
  const env = {
    ...process.env,
    PATH: `${dir}:${process.env.PATH}`,
    APP_ENV_FILE: join(dir, 'app.env'),
    BACKUP_DIR: join(dir, 'backups'),
    DOCKER_CALLS: join(dir, 'calls'),
    RESTORE_READY_ATTEMPTS: '1',
  };
  return { dir, env };
}

test('failed dump is not published; successful backup has checksum and restores core tables', async (t) => {
  const { dir, env } = await setup(t);
  const backup = resolve('scripts/db-backup.sh');
  const restore = resolve('scripts/db-restore-test.sh');
  assert.notEqual(
    spawnSync('sh', [backup], { env: { ...env, DUMP_EXIT: '1' } }).status,
    0,
  );
  assert.deepEqual(await readdir(env.BACKUP_DIR), []);
  assert.equal(spawnSync('sh', [backup], { env }).status, 0);
  const files = await readdir(env.BACKUP_DIR);
  assert.equal(files.length, 2);
  assert.equal(spawnSync('sh', [restore], { env }).status, 0);
  const calls = await readFile(join(dir, 'calls'), 'utf8');
  assert.match(calls, /pg_restore --exit-on-error/);
  assert.match(calls, /SELECT count\(\*\) FROM finance.payout/);
  assert.match(calls, /rm -f marketplace-restore-test-/);
  assert.notEqual(
    spawnSync('sh', [restore], { env: { ...env, SCHEMA_EXIT: '1' } }).status,
    0,
  );
  assert.notEqual(
    spawnSync('sh', [restore], { env: { ...env, RESTORE_EXIT: '1' } }).status,
    0,
  );
  assert.notEqual(
    spawnSync('sh', [restore], { env: { ...env, READY_EXIT: '1' } }).status,
    0,
  );
  const dump = files.find((name) => name.endsWith('.dump'));
  await writeFile(join(env.BACKUP_DIR, dump), 'corrupted');
  assert.notEqual(spawnSync('sh', [restore], { env }).status, 0);
});
