import type { DatabaseDefinition } from '@app/common';
import { CreateSearchIndex1722945600000 } from './migrations/1722945600000-create-search-index';
import { MoneyToBigint1795219200000 } from './migrations/1795219200000-money-to-bigint';
import { DropShopFields1796083200001 } from './migrations/1796083200001-drop-shop-fields';
import { SearchDocument } from './entities/search-document.entity';

/**
 * search-service bazasi (BE-04): sxema, entity va migratsiyalar bitta joyda — modul (`search.module.ts`) va migratsiya CLI
 * (`migrate.ts`) shu ro‘yxatdan foydalanadi. Yangi migratsiya shu yerga qo‘shiladi.
 */
export const SEARCH_DB: DatabaseDefinition = {
  schema: 'search',
  entities: [SearchDocument],
  migrations: [
    CreateSearchIndex1722945600000,
    MoneyToBigint1795219200000,
    DropShopFields1796083200001,
  ],
};
