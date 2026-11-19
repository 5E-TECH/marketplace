import type { DatabaseDefinition } from '@app/common';
import { CreateLeadTables1794787200000 } from './migrations/1794787200000-create-lead-tables';
import { CreateOfferContent1794873600000 } from './migrations/1794873600000-create-offer-content';
import { AddLeadReview1794960000000 } from './migrations/1794960000000-add-lead-review';
import { AddLeadQueue1795046400000 } from './migrations/1795046400000-add-lead-queue';
import { AddApiLeads1795132800000 } from './migrations/1795132800000-add-api-leads';
import { AddLeadStats1795564800000 } from './migrations/1795564800000-add-lead-stats';
import { AddCapiFields1795651200000 } from './migrations/1795651200000-add-capi-fields';
import { AddFraudCenter1795824000000 } from './migrations/1795824000000-add-fraud-center';
import { LEAD_ENTITIES } from './entities';

/**
 * lead-service bazasi (BE-04): sxema, entity va migratsiyalar bitta joyda — modul (`lead.module.ts`) va migratsiya CLI
 * (`migrate.ts`) shu ro‘yxatdan foydalanadi. Yangi migratsiya shu yerga qo‘shiladi.
 */
export const LEAD_DB: DatabaseDefinition = {
  schema: 'lead',
  entities: LEAD_ENTITIES,
  migrations: [
    CreateLeadTables1794787200000,
    CreateOfferContent1794873600000,
    AddLeadReview1794960000000,
    AddLeadQueue1795046400000,
    AddApiLeads1795132800000,
    AddLeadStats1795564800000,
    AddCapiFields1795651200000,
    AddFraudCenter1795824000000,
  ],
};
