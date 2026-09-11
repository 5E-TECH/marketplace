import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const validator = resolve('scripts/validate-production-env.sh');

const validEnv = {
  DB_PASSWORD: 'db-secret',
  RABBITMQ_PASSWORD: 'rabbit-secret',
  JWT_SECRET: 'jwt-secret',
  JWT_REFRESH_SECRET: 'refresh-secret',
  INTEGRATION_CREDENTIAL_SECRET: 'integration-secret',
  MINIO_SECRET_KEY: 'minio-secret',
  CORS_ORIGINS: 'https://admin.marketplace.uz',
  ELCHI_PARTNER_API_URL: 'https://api.elchipochta.uz',
  ELCHI_PARTNER_API_KEY: 'elp_test_key',
  DOMAIN: ':80',
};

async function run(t, values) {
  const dir = await mkdtemp(join(tmpdir(), 'production-env-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, '.env.production');
  await writeFile(
    file,
    `${Object.entries(values)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n')}\n`,
  );
  return spawnSync('sh', [validator, file], { encoding: 'utf8' });
}

test('Elchi partner konfiguratsiyasi bo‘lmasa production deployni to‘xtatadi', async (t) => {
  const { ELCHI_PARTNER_API_KEY: _, ...missingKey } = validEnv;
  const result = await run(t, missingKey);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /ELCHI_PARTNER_API_KEY/);
});

test('Elchi partner konfiguratsiyasi bilan production env auditdan o‘tadi', async (t) => {
  const result = await run(t, validEnv);

  assert.equal(result.status, 0, result.stderr);
});
