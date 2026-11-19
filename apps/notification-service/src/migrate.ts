/**
 * Migratsiya CLI (BE-04): `node dist/apps/notification-service/apps/notification-service/src/migrate.js <run|revert|show|check>` (prod,
 * `DB_AUTO_MIGRATE=false`), dev da — `npm run db:migrate -- notification-service`. Ulanish servis bilan bir xil (`DB_*`).
 */
import { runMigrationCli } from '@app/common';
import { NOTIFICATION_DB } from './database';

void runMigrationCli(NOTIFICATION_DB, process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error);
    process.exit(1);
  },
);
