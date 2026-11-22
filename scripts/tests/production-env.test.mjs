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
  REDIS_URL: _redisUrl,
  REDIS_PASSWORD: _redisPassword,
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

test('BE-36: Redis ixtiyoriy; REDIS_URL parol bilan, profil yoqilsa parol URL bilan bir xil', async (t) => {
  const password = 'a1b2c3d4e5f6a7b8c9d0e1f2';
  const enabled = {
    ...validEnv,
    COMPOSE_PROFILES: 'tunnel,redis',
    REDIS_PASSWORD: password,
    REDIS_URL: `redis://:${password}@redis:6379`,
  };
  const ok = await run(t, enabled);
  assert.equal(ok.status, 0, ok.stderr);
  assert.doesNotMatch(ok.stderr, /REDIS/);

  const noPassword = await run(t, {
    ...validEnv,
    REDIS_URL: 'redis://redis:6379',
  });
  assert.notEqual(noPassword.status, 0);
  assert.match(noPassword.stderr, /REDIS_URL parol bilan/);

  const mismatch = await run(t, {
    ...enabled,
    REDIS_URL: 'redis://:boshqa-parol@redis:6379',
  });
  assert.notEqual(mismatch.status, 0);
  assert.match(mismatch.stderr, /bir xil emas/);

  const profileWithoutPassword = await run(t, {
    ...validEnv,
    COMPOSE_PROFILES: 'redis',
  });
  assert.notEqual(profileWithoutPassword.status, 0);
  assert.match(profileWithoutPassword.stderr, /REDIS_PASSWORD kerak/);

  // Profil yoqilmagan — deploy to'xtamaydi, faqat eslatiladi (limit nusxa xotirasida).
  const noProfile = await run(t, {
    ...validEnv,
    REDIS_URL: `redis://:${password}@redis:6379`,
  });
  assert.equal(noProfile.status, 0, noProfile.stderr);
  assert.match(noProfile.stderr, /COMPOSE_PROFILES da redis yo‘q/);

  // Tashqi (boshqariladigan) Redis — profil shart emas.
  const external = await run(t, {
    ...validEnv,
    REDIS_URL: `rediss://default:${password}@cache.internal:6380`,
  });
  assert.equal(external.status, 0, external.stderr);
  assert.doesNotMatch(external.stderr, /REDIS/);
});
