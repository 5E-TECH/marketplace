import type { DatabaseDefinition } from '@app/common';
import { CreateFinanceTables1724673600000 } from './migrations/1724673600000-create-finance-tables';
import { CreateCodReconciliation1724932800000 } from './migrations/1724932800000-create-cod-reconciliation';
import { CreatePayoutSchedule1727568000000 } from './migrations/1727568000000-create-payout-schedule';
import { CreateLedger1795478400000 } from './migrations/1795478400000-create-ledger';
import { AddJournalLeadIndex1795564800000 } from './migrations/1795564800000-add-journal-lead-index';
import { CreateWithdrawal1795651200000 } from './migrations/1795651200000-create-withdrawal';
import { CreateWholesalerSettlement1795737600000 } from './migrations/1795737600000-create-wholesaler-settlement';
import { CreateFeeHold1795824000000 } from './migrations/1795824000000-create-fee-hold';
import { AddRemittanceResolution1796860800000 } from './migrations/1796860800000-add-remittance-resolution';
import { CreateSettlementResponse1796947200000 } from './migrations/1796947200000-create-settlement-response';
import { SettingComment1797552000000 } from './migrations/1797552000000-setting-comment';
import { CreateElchiCheck1797638400000 } from './migrations/1797638400000-create-elchi-check';
import { CreateSelfEmployed1798761600000 } from './migrations/1798761600000-create-self-employed';
import { CreatePayoutCard1799107200000 } from './migrations/1799107200000-create-payout-card';
import { CreateReturnPending1799193600000 } from './migrations/1799193600000-create-return-pending';
import { CreateCodDailyCheck1796601600000 } from './migrations/1796601600000-create-cod-daily-check';
import { CreateTextSetting1796774400000 } from './migrations/1796774400000-create-text-setting';
import { SellerLedger } from './entities/seller-ledger.entity';
import { Payout } from './entities/payout.entity';
import { Commission } from './entities/commission.entity';
import { CodReconciliation } from './entities/cod-reconciliation.entity';
import { PayoutSchedule } from './entities/payout-schedule.entity';

/**
 * finance-service bazasi (BE-04): sxema, entity va migratsiyalar bitta joyda — modul (`finance.module.ts`) va migratsiya CLI
 * (`migrate.ts`) shu ro‘yxatdan foydalanadi. Yangi migratsiya shu yerga qo‘shiladi.
 */
export const FINANCE_DB: DatabaseDefinition = {
  schema: 'finance',
  entities: [
    SellerLedger,
    Payout,
    Commission,
    CodReconciliation,
    PayoutSchedule,
  ],
  migrations: [
    CreateFinanceTables1724673600000,
    CreateCodReconciliation1724932800000,
    CreatePayoutSchedule1727568000000,
    CreateLedger1795478400000,
    AddJournalLeadIndex1795564800000,
    CreateWithdrawal1795651200000,
    CreateWholesalerSettlement1795737600000,
    CreateFeeHold1795824000000,
    AddRemittanceResolution1796860800000,
    CreateSettlementResponse1796947200000,
    SettingComment1797552000000,
    CreateElchiCheck1797638400000,
    CreateCodDailyCheck1796601600000,
    CreateTextSetting1796774400000,
    CreateSelfEmployed1798761600000,
    CreatePayoutCard1799107200000,
    CreateReturnPending1799193600000,
  ],
};
