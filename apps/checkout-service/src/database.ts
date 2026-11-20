import type { DatabaseDefinition } from '@app/common';
import { CreateCheckoutTables1722513600000 } from './migrations/1722513600000-create-checkout-tables';
import { CreateCartTables1723032000000 } from './migrations/1723032000000-create-cart-tables';
import { CreateOrderHistory1723200000000 } from './migrations/1723200000000-create-order-history';
import { CreateElchiWebhookEvent1724587200000 } from './migrations/1724587200000-create-elchi-webhook-event';
import { AddDeliveryFee1725192000000 } from './migrations/1725192000000-add-delivery-fee';
import { AddSalesOrderSessionId1726329600000 } from './migrations/1726329600000-add-sales-order-session-id';
import { AddCartItemProductName1726416000000 } from './migrations/1726416000000-add-cart-item-product-name';
import { AddSellerOrderQrToken1726502400000 } from './migrations/1726502400000-add-seller-order-qr-token';
import { AddSellerOrderToBePaid1726588800000 } from './migrations/1726588800000-add-seller-order-to-be-paid';
import { CreateReturnRequests1727481600000 } from './migrations/1727481600000-create-return-requests';
import { MoneyToBigint1795219200000 } from './migrations/1795219200000-money-to-bigint';
import { CreateCheckoutOutbox1795305600000 } from './migrations/1795305600000-create-checkout-outbox';
import { LeadOrder1796342400000 } from './migrations/1796342400000-lead-order';
import { ParcelFulfillment1796428800000 } from './migrations/1796428800000-parcel-fulfillment';
import { Cart } from './entities/cart.entity';
import { CartItem } from './entities/cart-item.entity';
import { OutboxEvent } from '@app/common';

/**
 * checkout-service bazasi (BE-04): sxema, entity va migratsiyalar bitta joyda — modul (`checkout.module.ts`) va migratsiya CLI
 * (`migrate.ts`) shu ro‘yxatdan foydalanadi. Yangi migratsiya shu yerga qo‘shiladi.
 */
export const CHECKOUT_DB: DatabaseDefinition = {
  schema: 'checkout',
  entities: [Cart, CartItem, OutboxEvent],
  migrations: [
    CreateCheckoutTables1722513600000,
    CreateCartTables1723032000000,
    CreateOrderHistory1723200000000,
    CreateElchiWebhookEvent1724587200000,
    AddDeliveryFee1725192000000,
    AddSalesOrderSessionId1726329600000,
    AddCartItemProductName1726416000000,
    AddSellerOrderQrToken1726502400000,
    AddSellerOrderToBePaid1726588800000,
    CreateReturnRequests1727481600000,
    MoneyToBigint1795219200000,
    CreateCheckoutOutbox1795305600000,
    LeadOrder1796342400000,
    ParcelFulfillment1796428800000,
  ],
};
