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

test('BE-26: zaxira BACKUP_REMOTE ga yuboriladi va u yerda checksum tekshiriladi', async (t) => {
  const { dir, env } = await setup(t);
  const remote = join(dir, 'remote');
  // scp/ssh o'rnida: «server» — mahalliy papka (host: qismi tashlanadi)
  await writeFile(
    join(dir, 'scp'),
    `#!/bin/sh
for a in "$@"; do last="$a"; done
dest=\${last#*:}
mkdir -p "$dest"
for a in "$@"; do
  case "$a" in -*|"$last") ;; *) [ -f "$a" ] && cp "$a" "$dest/" ;; esac
done
`,
    { mode: 0o700 },
  );
  await writeFile(
    join(dir, 'ssh'),
    `#!/bin/sh
for a in "$@"; do last="$a"; done
if [ -n "\${SSH_FAKE_HASH:-}" ]; then printf '%s\\n' "$SSH_FAKE_HASH"; exit 0; fi
sh -c "$last"
`,
    { mode: 0o700 },
  );
  const backup = resolve('scripts/db-backup.sh');
  const ok = spawnSync('sh', [backup], {
    env: { ...env, BACKUP_REMOTE: `backup@zaxira:${remote}` },
  });
  assert.equal(ok.status, 0, String(ok.stderr));
  assert.match(String(ok.stdout), /Tashqi zaxira tayyor/);
  const copied = await readdir(remote);
  assert.equal(copied.filter((f) => f.endsWith('.dump')).length, 1);
  assert.equal(copied.filter((f) => f.endsWith('.sha256')).length, 1);

  const bad = spawnSync('sh', [backup], {
    env: {
      ...env,
      BACKUP_REMOTE: `backup@zaxira:${remote}`,
      SSH_FAKE_HASH: 'deadbeef',
    },
  });
  assert.equal(bad.status, 4);
  assert.match(String(bad.stderr), /checksum ga mos emas/);

  const missing = spawnSync('sh', [backup], {
    env: { ...env, BACKUP_REMOTE_REQUIRED: 'on' },
  });
  assert.equal(missing.status, 3);
  assert.match(String(missing.stderr), /BACKUP_REMOTE berilmagan/);
});
