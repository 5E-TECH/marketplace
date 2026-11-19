#!/usr/bin/env node
/**
 * Migratsiya CLI (BE-04): `node scripts/migrate.mjs <run|revert|show|check> [servis ...]`.
 * Servis berilmasa — bazasi bor hamma servis, ketma-ket. Dev/CI da TypeScript manbadan (ts-node), `--dist` bilan
 * yoki prod konteynerida — build qilingan `dist/apps/<servis>/apps/<servis>/src/migrate.js` dan.
 * Ulanish servislar bilan bir xil: `DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, `DB_NAME` (yoki `MIGRATE_DATABASE_URL`).
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

export const SERVICES = [
  'identity-service',
  'catalog-service',
  'inventory-service',
  'checkout-service',
  'payment-service',
  'finance-service',
  'notification-service',
  'search-service',
  'elchi-integration',
  'lead-service',
];

const root = path.resolve(import.meta.dirname, '..');
const [command, ...rest] = process.argv.slice(2);
const fromDist = rest.includes('--dist');
const services = rest.filter((arg) => !arg.startsWith('--'));
const targets = services.length ? services : SERVICES;
for (const service of targets)
  if (!SERVICES.includes(service)) {
    console.error(`noma’lum servis: ${service}`);
    process.exit(2);
  }

/**
 * Servis modullari import qilinganda umumiy config moduli Joi bilan hamma sozlamani tekshiradi. Migratsiyaga faqat
 * baza kerak — qolgan majburiy qiymatlar berilmagan bo‘lsa o‘rinbosar qo‘yiladi (`export-openapi.mjs` dagi kabi);
 * hech qanday ulanish ochilmaydi. Prod konteynerida ular baribir haqiqiy qiymat bilan bor.
 */
const placeholders = {
  RABBITMQ_URL: 'amqp://localhost:5672',
  MINIO_ENDPOINT: 'localhost',
  MINIO_ACCESS_KEY: 'migrate-access-key',
  MINIO_SECRET_KEY: 'migrate-secret-key',
  MINIO_PUBLIC_URL: 'http://localhost:9000',
  JWT_SECRET: 'migrate-placeholder-secret-value',
  JWT_REFRESH_SECRET: 'migrate-placeholder-refresh-secret',
  INTEGRATION_CREDENTIAL_SECRET: 'migrate-placeholder-integration-secret',
};
const env = { ...process.env };
for (const [key, value] of Object.entries(placeholders)) env[key] ??= value;
// `MIGRATE_DATABASE_URL` bilan DB_* ishlatilmaydi, lekin config sxemasi ularni so‘raydi.
if (env.MIGRATE_DATABASE_URL)
  for (const key of ['DB_HOST', 'DB_USERNAME', 'DB_PASSWORD', 'DB_NAME'])
    env[key] ||= 'migrate-url';

let failed = 0;
for (const service of targets) {
  const dist = path.join(
    root,
    'dist/apps',
    service,
    'apps',
    service,
    'src/migrate.js',
  );
  const args =
    fromDist || !existsSync(path.join(root, 'node_modules/ts-node'))
      ? [dist, command]
      : [
          '-r',
          'ts-node/register/transpile-only',
          '-r',
          'tsconfig-paths/register',
          path.join(root, 'apps', service, 'src/migrate.ts'),
          command,
        ];
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...env,
      TS_NODE_PROJECT: path.join(root, 'apps', service, 'tsconfig.app.json'),
    },
  });
  if (result.status !== 0) failed += 1;
}
process.exit(failed ? 1 : 0);
