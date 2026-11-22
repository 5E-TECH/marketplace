import type { DatabaseDefinition } from '@app/common';
import { CreateIntegrationTables1722900000000 } from './migrations/1722900000000-create-integration-tables';
import { AddGeoSatoCode1725285600000 } from './migrations/1725285600000-add-geo-sato-code';
import { AddProvisionTariffs1725375600000 } from './migrations/1725375600000-add-provision-tariffs';
import { MoneyToBigint1795219200000 } from './migrations/1795219200000-money-to-bigint';
import { CreateParcelQueue1795392000000 } from './migrations/1795392000000-create-parcel-queue';
import { ElchiApiError1797638400000 } from './migrations/1797638400000-elchi-api-error';
import { ElchiMarketProvision } from './entities/elchi-market-provision.entity';
import { GeoCache } from './entities/geo-cache.entity';
import { OutboxEvent } from '@app/common';

/**
 * elchi-integration bazasi (BE-04): sxema, entity va migratsiyalar bitta joyda — modul (`elchi-integration.module.ts`) va migratsiya CLI
 * (`migrate.ts`) shu ro‘yxatdan foydalanadi. Yangi migratsiya shu yerga qo‘shiladi.
 */
export const INTEGRATION_DB: DatabaseDefinition = {
  schema: 'integration',
  entities: [ElchiMarketProvision, GeoCache, OutboxEvent],
  migrations: [
    CreateIntegrationTables1722900000000,
    AddGeoSatoCode1725285600000,
    AddProvisionTariffs1725375600000,
    MoneyToBigint1795219200000,
    CreateParcelQueue1795392000000,
    ElchiApiError1797638400000,
  ],
};
