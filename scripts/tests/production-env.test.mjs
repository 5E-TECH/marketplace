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
  // C4.8: tunnelsiz zanjir caddy -> api-gateway (1 bosqich).
  TRUST_PROXY_HOPS: '1',
};

// Validator fayl bo'sh qolsa export qilingan qiymatni oladi — CI/dev muhitidagi
// qiymatlar natijaga aralashmasin.
const {
  TRUST_PROXY_HOPS: _hops,
  COMPOSE_PROFILES: _profiles,
  ...baseEnv
} = process.env;

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
  return spawnSync('sh', [validator, file], { encoding: 'utf8', env: baseEnv });
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

test('C4.8: TRUST_PROXY_HOPS berilmasa deploy to‘xtaydi', async (t) => {
  const { TRUST_PROXY_HOPS: _, ...missingHops } = validEnv;
  const result = await run(t, missingHops);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /TRUST_PROXY_HOPS=1/);
});

test('C4.8: Cloudflare tunnel bilan zanjir 2 bosqichli bo‘lishi shart', async (t) => {
  const tunnel = { ...validEnv, COMPOSE_PROFILES: 'tunnel' };

  const wrong = await run(t, tunnel);
  assert.notEqual(wrong.status, 0);
  assert.match(wrong.stderr, /2 bosqichli/);

  const right = await run(t, { ...tunnel, TRUST_PROXY_HOPS: '2' });
  assert.equal(right.status, 0, right.stderr);
});
