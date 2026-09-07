import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkC46Config } from '../c46-preflight.mjs';

test('HTTP fallback and missing alert are not accepted as production TC evidence', () => {
  assert.equal(checkC46Config({ DOMAIN: ':80' }).length, 3);
  assert.deepEqual(
    checkC46Config({
      DOMAIN: 'api.company.uz',
      ALERT_WEBHOOK_URL: 'https://alerts.company.uz/private',
      ELCHI_WEBHOOK_SECRET: 'secret',
    }),
    [],
  );
  assert.equal(
    checkC46Config({
      DOMAIN: 'kabinet.localhost',
      ALERT_WEBHOOK_URL: 'http://alerts.company.uz',
      ELCHI_WEBHOOK_SECRET: 'secret',
    }).length,
    2,
  );
});
