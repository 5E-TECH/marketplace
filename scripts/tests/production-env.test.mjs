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

// Validator fayl bo'sh qolsa export qilingan qiymatni oladi — CI/dev muhitidagi
// qiymatlar natijaga aralashmasin.
const {
  TRUST_PROXY_HOPS: _hops,
  COMPOSE_PROFILES: _profiles,
  AUTH_TOKENS_IN_BODY: _authInBody,
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

test('C4.8: TRUST_PROXY_HOPS talab qilinmaydi — tunnel bilan ham, tunnelsiz ham', async (t) => {
  // Ishonchli proksilar endi tarmoq bo'yicha aniqlanadi
  // (apps/api-gateway/src/trust-proxy.ts) — zanjir uzunligiga bog'liq emas.
  for (const env of [validEnv, { ...validEnv, COMPOSE_PROFILES: 'tunnel' }]) {
    const result = await run(t, env);
    assert.equal(result.status, 0, result.stderr);
  }
});

test('C4.8: eski TRUST_PROXY_HOPS qolsa deploy to‘xtamaydi, faqat eslatiladi', async (t) => {
  const result = await run(t, { ...validEnv, TRUST_PROXY_HOPS: '2' });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /TRUST_PROXY_HOPS endi ishlatilmaydi/);
});

test('AUTH_TOKENS_IN_BODY false bo‘lmasa deploy to‘xtamaydi, lekin eslatiladi', async (t) => {
  const legacy = await run(t, { ...validEnv, AUTH_TOKENS_IN_BODY: 'true' });
  assert.equal(legacy.status, 0, legacy.stderr);
  assert.match(legacy.stderr, /AUTH_TOKENS_IN_BODY=true/);

  const cookieOnly = await run(t, {
    ...validEnv,
    AUTH_TOKENS_IN_BODY: 'false',
  });
  assert.equal(cookieOnly.status, 0, cookieOnly.stderr);
  assert.doesNotMatch(cookieOnly.stderr, /AUTH_TOKENS_IN_BODY/);
});
