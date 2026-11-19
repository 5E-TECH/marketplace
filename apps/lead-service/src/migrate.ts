/**
 * Migratsiya CLI (BE-04): `node dist/apps/lead-service/apps/lead-service/src/migrate.js <run|revert|show|check>` (prod,
 * `DB_AUTO_MIGRATE=false`), dev da — `npm run db:migrate -- lead-service`. Ulanish servis bilan bir xil (`DB_*`).
 */
import { runMigrationCli } from '@app/common';
import { LEAD_DB } from './database';

void runMigrationCli(LEAD_DB, process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error);
    process.exit(1);
  },
);
