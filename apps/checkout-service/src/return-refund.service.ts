import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { DataSource } from 'typeorm';
import {
  CheckoutPaymentMethod,
  FinanceRefundRequestedEvent,
  QUALITY_RETURN_REASONS,
  RefundPaymentDto,
  RefundPaymentResult,
  ReturnOrderItemsDto,
  ReturnReason,
  ReturnRequestDetailsDto,
  ReturnRequestStatus,
  RmqClient,
  sendRpc,
} from '@app/common';
import {
  assertReturnId,
  ReturnRequestQueryService,
} from './return-request-query.service';
import { ReturnNotifierService } from './return-notifier.service';
import { ReturnActor, writeReturnHistory } from './return-history';

interface RefundTarget {
  id: string;
  status: ReturnRequestStatus;
  reason: ReturnReason;
  requestedAmount: number;
  orderId: string;
  sellerOrderId: string;
  shopId: string;
  customerId: string;
  orderStatus: string;
  paymentMethod: CheckoutPaymentMethod;
  paymentId: string | null;
}

/**
 * C4.2 — tasdiqlangan qaytarish bo'yicha pulni qaytarish (qisman ham).
 *
 *   • online: provayder to'lovidan faqat shu summa qaytariladi;
 *   • COD: naqd pul sotuvchida (Elchi to'g'ridan unga beradi) — admin
 *     xaridorga pulni qo'lda qaytaradi va izohda qanday qaytarilganini yozadi;
 *   • ikkala holatda sotuvchi ledgeridan summa (komissiyaning mos ulushi
 *     qaytarilgan holda) yechiladi — manfiy qoldiq keyingi payout'dan ushlanadi;
 *   • sifatli tovar omborga qaytadi, brak/shikast/boshqa tovar — qaytmaydi.
 *
 * Har tashqi chaqiruv `return-refund:<id>` kaliti bilan idempotent: oqim
 * o'rtada uzilsa, qayta chaqirish ikkinchi marta pul/qoldiq qaytarmaydi.
 */
@Injectable()
export class ReturnRefundService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly queries: ReturnRequestQueryService,
    private readonly notifier: ReturnNotifierService,
    @Optional()
    @Inject(RmqClient.PAYMENT)
    private readonly payment?: ClientProxy,
    @Optional()
    @Inject(RmqClient.INVENTORY)
    private readonly inventory?: ClientProxy,
    @Optional()
    @Inject(RmqClient.FINANCE)
    private readonly finance?: ClientProxy,
  ) {}

  async refund(input: {
    returnId: string;
    actor: ReturnActor;
    amount?: number;
    restock?: boolean;
    comment?: string | null;
  }): Promise<ReturnRequestDetailsDto> {
    assertReturnId(input.returnId);
    if (!this.payment || !this.inventory || !this.finance) {
      throw new BadRequestException('Refund servislaridan biri ulanmagan');
    }
    const key = `return-refund:${input.returnId}`;
    const comment = input.comment?.trim() || null;

    const done = await this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [key]);
      const [target] = (await manager.query(
        `SELECT r.id::text,r.status,r.reason,
                r.requested_amount::float8 AS "requestedAmount",
                r.sales_order_id::text AS "orderId",
                r.sales_order_seller_id::text AS "sellerOrderId",
                r.shop_id::text AS "shopId",r.customer_id::text AS "customerId",
                o.status AS "orderStatus",o.payment_method AS "paymentMethod",
                o.payment_id::text AS "paymentId"
           FROM checkout.return_request r
           JOIN checkout.sales_order o ON o.id=r.sales_order_id
          WHERE r.id=$1 FOR UPDATE OF r`,
        [input.returnId],
      )) as RefundTarget[];
      if (!target) throw new NotFoundException('Qaytarish so‘rovi topilmadi');
      if (target.status === ReturnRequestStatus.REFUNDED) return null;
      this.assertRefundable(target, input.amount, comment);

      const cod = target.paymentMethod === CheckoutPaymentMethod.COD;
      const restock =
        input.restock ?? !QUALITY_RETURN_REASONS.includes(target.reason);
      let amount = this.money(input.amount ?? target.requestedAmount);
      const reason = `Qaytarish so‘rovi #${target.id}`;

      if (!cod) {
        const paid = await sendRpc<RefundPaymentResult>(
          this.payment!,
          { cmd: 'payment.refund' },
          {
            paymentId: target.paymentId ?? undefined,
            salesOrderId: target.orderId,
            sellerOrderId: target.sellerOrderId,
            reason,
            idempotencyKey: key,
            amount,
          } satisfies RefundPaymentDto,
        );
        // Takroriy chaqiruvda provayder avval yozilgan summani qaytaradi —
        // ledger va so'rov shu haqiqiy summa bilan yoziladi.
        amount = this.money(paid.amount ?? amount);
      }
      if (restock) {
        const items = (await manager.query(
          `SELECT i.variant_id::text AS "variantId",SUM(ri.quantity)::int AS quantity
             FROM checkout.return_request_item ri
             JOIN checkout.sales_order_item i ON i.id=ri.sales_order_item_id
            WHERE ri.return_request_id=$1
            GROUP BY i.variant_id`,
          [target.id],
        )) as ReturnOrderItemsDto['items'];
        await sendRpc(
          this.inventory!,
          { cmd: 'inventory.return-order-items' },
          {
            orderRef: target.orderId,
            items,
            reason,
            idempotencyKey: key,
          } satisfies ReturnOrderItemsDto,
        );
      }
      await sendRpc(this.finance!, { cmd: 'finance.refund' }, {
        eventId: key,
        sellerOrderId: target.sellerOrderId,
        shopId: target.shopId,
        occurredAt: new Date().toISOString(),
        amount,
        returnRequestId: target.id,
      } satisfies FinanceRefundRequestedEvent);

      await manager.query(
        `UPDATE checkout.return_request
            SET status=$2,refunded_amount=$3,restocked=$4,refunded_by=$5,
                refunded_at=now(),updated_at=now()
          WHERE id=$1`,
        [
          target.id,
          ReturnRequestStatus.REFUNDED,
          amount,
          restock,
          input.actor.id,
        ],
      );
      await writeReturnHistory(manager, {
        returnId: target.id,
        from: target.status,
        to: ReturnRequestStatus.REFUNDED,
        actor: input.actor,
        comment,
      });
      return { target, amount };
    });

    if (done) {
      await this.notifier.notify(
        {
          returnId: done.target.id,
          orderId: done.target.orderId,
          status: ReturnRequestStatus.REFUNDED,
          comment,
          amount: done.amount,
        },
        { customerId: done.target.customerId, shopId: done.target.shopId },
      );
    }
    return this.queries.get(input.returnId);
  }

  private assertRefundable(
    target: RefundTarget,
    amount: number | undefined,
    comment: string | null,
  ): void {
    if (target.status !== ReturnRequestStatus.APPROVED) {
      throw new BadRequestException(
        'Faqat tasdiqlangan (APPROVED) so‘rov bo‘yicha pul qaytariladi',
      );
    }
    if (target.orderStatus === 'REFUNDED') {
      throw new BadRequestException(
        'Buyurtma puli allaqachon to‘liq qaytarilgan',
      );
    }
    if (amount !== undefined) {
      const value = this.money(amount);
      if (value <= 0 || value > this.money(target.requestedAmount)) {
        throw new BadRequestException(
          `Summa 0 dan katta va so‘rovdagi tovarlar summasidan (${target.requestedAmount}) oshmasligi kerak`,
        );
      }
    }
    if (target.paymentMethod === CheckoutPaymentMethod.COD && !comment) {
      throw new BadRequestException(
        'Naqd (COD) buyurtmada pul xaridorga qo‘lda qaytariladi — izohda qanday qaytarilganini yozing',
      );
    }
  }

  private money(value: number): number {
    return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
  }
}
