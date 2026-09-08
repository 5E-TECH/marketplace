import { spawnSync } from 'node:child_process';

const databaseUrl =
  process.env.PAYMENT_TEST_DATABASE_URL ??
  process.argv.slice(2).find((argument) => !argument.startsWith('--'));
try {
  if (
    !databaseUrl ||
    !new URL(databaseUrl).pathname.endsWith('_payment_test')
  ) {
    throw new Error('Invalid test database');
  }
} catch {
  console.error(
    'PAYMENT_TEST_DATABASE_URL must point to an isolated database ending in _payment_test.',
  );
  process.exit(1);
}
const all = process.argv.includes('--all');
const targets = all
  ? []
  : [
      'apps/payment-service',
      'apps/api-gateway/src/payments/payments.http.spec.ts',
    ];
const result = spawnSync(
  process.execPath,
  ['node_modules/jest/bin/jest.js', '--runInBand', ...targets],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      PAYMENT_TEST_DATABASE_URL: databaseUrl,
      PAYMENT_HTTP_TEST: '1',
      ...(all ? { TEST_DATABASE_URL: databaseUrl } : {}),
    },
  },
);
process.exit(result.status ?? 1);
