import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

async function setup(
  t,
  envFile = 'DB_USERNAME=elchi\nDB_NAME=elchi_marketplace\n',
) {
  const dir = await mkdtemp(join(tmpdir(), 'be40-launch-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, 'app.env'), envFile);
  await writeFile(
    join(dir, 'docker'),
    `#!/bin/sh
printf '%s\\n' "$*" >> "$DOCKER_CALLS"
case "$*" in
  *pg_dump*) printf 'eski baza dump'; exit 0 ;;
  *"FROM pg_database"*) printf '%s' "\${FAKE_EXISTS:-}"; exit 0 ;;
  *"information_schema.tables"*) printf '%s' "\${FAKE_TABLES:-0}"; exit 0 ;;
  *"CREATE DATABASE"*) exit 0 ;;
esac
`,
    { mode: 0o700 },
  );
  // zaxira serveri — mahalliy papka
  await writeFile(
    join(dir, 'scp'),
    `#!/bin/sh
for a in "$@"; do last="$a"; done
dest=\${last#*:}
mkdir -p "$(dirname "$dest")"
for a in "$@"; do case "$a" in -*|"$last") ;; *) [ -f "$a" ] && cp "$a" "$dest" ;; esac; done
`,
    { mode: 0o700 },
  );
  await writeFile(
    join(dir, 'ssh'),
    `#!/bin/sh\nfor a in "$@"; do last="$a"; done\nsh -c "$last"\n`,
    {
      mode: 0o700,
    },
  );
  const env = {
    ...process.env,
    PATH: `${dir}:${process.env.PATH}`,
    APP_ENV_FILE: join(dir, 'app.env'),
    BACKUP_DIR: join(dir, 'backups'),
    BACKUP_REMOTE: `backup@zaxira:${join(dir, 'remote')}`,
    DOCKER_CALLS: join(dir, 'calls'),
  };
  return { dir, env };
}
const script = resolve('scripts/launch-fresh-db.sh');
const calls = async (dir) =>
  readFile(join(dir, 'calls'), 'utf8').catch(() => '');

test('BE-40: sukut — faqat ko‘rsatadi (arxiv ham, CREATE ham yo‘q)', async (t) => {
  const { dir, env } = await setup(t);
  const r = spawnSync('sh', [script, 'elchi_marketplace_v2'], { env });
  assert.equal(r.status, 0, String(r.stderr));
  assert.match(String(r.stdout), /Hech narsa o‘zgarmadi/);
  const c = await calls(dir);
  assert.doesNotMatch(c, /pg_dump|CREATE DATABASE/);
});

test('BE-40: --apply — eski baza arxivi boshqa serverga, keyin yangi bo‘sh baza', async (t) => {
  const { dir, env } = await setup(t);
  const r = spawnSync('sh', [script, 'elchi_marketplace_v2', '--apply'], {
    env,
  });
  assert.equal(r.status, 0, String(r.stderr));
  const c = await calls(dir);
  assert.ok(
    c.indexOf('pg_dump') <
      c.indexOf('CREATE DATABASE "elchi_marketplace_v2" OWNER "elchi"'),
  );
  assert.equal(
    (await readdir(join(dir, 'remote'))).filter((f) => f.endsWith('.dump'))
      .length,
    1,
  );
});

test('BE-40: rad — nom bir xil, noto‘g‘ri nom, BACKUP_REMOTE yo‘q, yangi baza bo‘sh emas', async (t) => {
  const { dir, env } = await setup(t);
  assert.equal(
    spawnSync('sh', [script, 'elchi_marketplace', '--apply'], { env }).status,
    2,
  );
  assert.equal(
    spawnSync('sh', [script, 'Yomon-Nom', '--apply'], { env }).status,
    2,
  );
  assert.equal(
    spawnSync('sh', [script, 'elchi_marketplace_v2', '--apply'], {
      env: { ...env, BACKUP_REMOTE: '' },
    }).status,
    3,
  );
  const busy = spawnSync('sh', [script, 'elchi_marketplace_v2', '--apply'], {
    env: { ...env, FAKE_EXISTS: '1', FAKE_TABLES: '12' },
  });
  assert.equal(busy.status, 4);
  assert.doesNotMatch(await calls(dir), /CREATE DATABASE/);
});
