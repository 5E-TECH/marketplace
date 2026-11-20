/**
 * Migratsiya CLI (BE-04): `node dist/apps/elchi-integration/apps/elchi-integration/src/migrate.js <run|revert|show|check>` (prod,
 * `DB_AUTO_MIGRATE=false`), dev da — `npm run db:migrate -- elchi-integration`. Ulanish servis bilan bir xil (`DB_*`).
 */
import { runMigrationCli } from '@app/common';
import { INTEGRATION_DB } from './database';

void runMigrationCli(INTEGRATION_DB, process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error);
    process.exit(1);
  },
);
