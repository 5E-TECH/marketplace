/**
 * Migratsiya CLI (BE-04): `node dist/apps/catalog-service/apps/catalog-service/src/migrate.js <run|revert|show|check>` (prod,
 * `DB_AUTO_MIGRATE=false`), dev da — `npm run db:migrate -- catalog-service`. Ulanish servis bilan bir xil (`DB_*`).
 */
import { runMigrationCli } from '@app/common';
import { CATALOG_DB } from './database';

void runMigrationCli(CATALOG_DB, process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error);
    process.exit(1);
  },
);
