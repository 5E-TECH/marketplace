import type { DatabaseDefinition } from '@app/common';
import { CreatePaymentTables1724241600000 } from './migrations/1724241600000-create-payment-tables';
import { AddPaymeTransactionState1724328000000 } from './migrations/1724328000000-add-payme-transaction-state';
import { HardenPaymentCallbacks1724414400000 } from './migrations/1724414400000-harden-payment-callbacks';
import { CreatePaymentRefund1727481600000 } from './migrations/1727481600000-create-payment-refund';
import { Payment } from './entities/payment.entity';
import { PaymentTransaction } from './entities/payment-transaction.entity';
import { PaymentRefund } from './entities/payment-refund.entity';
import { ProviderConfig } from './entities/provider-config.entity';
import { OutboxEvent } from '@app/common';

/**
 * payment-service bazasi (BE-04): sxema, entity va migratsiyalar bitta joyda — modul (`payment.module.ts`) va migratsiya CLI
 * (`migrate.ts`) shu ro‘yxatdan foydalanadi. Yangi migratsiya shu yerga qo‘shiladi.
 */
export const PAYMENT_DB: DatabaseDefinition = {
  schema: 'payment',
  entities: [
    Payment,
    PaymentTransaction,
    PaymentRefund,
    ProviderConfig,
    OutboxEvent,
  ],
  migrations: [
    CreatePaymentTables1724241600000,
    AddPaymeTransactionState1724328000000,
    HardenPaymentCallbacks1724414400000,
    CreatePaymentRefund1727481600000,
  ],
};
