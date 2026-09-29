import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager } from 'typeorm';
import {
  CreateReturnRequestDto,
  CreateReturnRequestsResultDto,
  ReturnReason,
  ReturnRequestDetailsDto,
  ReturnRequestStatus,
  SalesOrderSellerStatus,
} from '@app/common';
import {
  assertReturnId,
  ReturnRequestQueryService,
} from './return-request-query.service';
import { ReturnNotifierService } from './return-notifier.service';
import { ReturnActor, writeReturnHistory } from './return-history';

interface OrderItemRow {
  orderItemId: string;
  sellerOrderId: string;
  shopId: string;
  sellerOrderStatus: string;
  quantity: number;
  unitPrice: number;
  deliveredAt: Date | string | null;
  sellerOrderUpdatedAt: Date | string;
  reservedQuantity: number;
}

interface TransitionRule {
  to: ReturnRequestStatus;
  from: ReturnRequestStatus[];
  /** Qaror (approve/reject) — decision_* ustunlari yangilanadi. */
  decision: boolean;
}

const S = ReturnRequestStatus;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Sotuvchi faqat o'z qarorini bir marta beradi; admin esa nizo yechadi —
 * sotuvchi qarorini teskarisiga o'zgartira oladi (pul qaytarilgunicha).
 */
const RULES = {
  review: { to: S.IN_REVIEW, from: [S.SUBMITTED], decision: false },
  sellerApprove: {
    to: S.APPROVED,
    from: [S.SUBMITTED, S.IN_REVIEW],
    decision: true,
  },
  sellerReject: {
    to: S.REJECTED,
    from: [S.SUBMITTED, S.IN_REVIEW],
    decision: true,
  },
  adminApprove: {
    to: S.APPROVED,
    from: [S.SUBMITTED, S.IN_REVIEW, S.REJECTED],
    decision: true,
  },
  adminReject: {
    to: S.REJECTED,
    from: [S.SUBMITTED, S.IN_REVIEW, S.APPROVED],
    decision: true,
  },
} satisfies Record<string, TransitionRule>;

export type ReturnTransition = keyof typeof RULES;

@Injectable()
export class ReturnRequestService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
    private readonly queries: ReturnRequestQueryService,
    private readonly notifier: ReturnNotifierService,
  ) {}

  /** Qaytarish muddati (kun) — posilka DELIVERED bo'lgan paytdan. */
  get windowDays(): number {
    return Number(this.config.get('RETURN_WINDOW_DAYS') ?? 10);
  }

  /**
   * Xaridor so'rovi. Tovarlar turli posilkalarda bo'lsa, har posilka uchun
   * alohida so'rov yaratiladi — har birini o'z do'koni ko'rib chiqadi.
   */
  async create(input: {
    orderId: string;
    customerId: string;
    dto: CreateReturnRequestDto;
  }): Promise<CreateReturnRequestsResultDto> {
    const { dto } = input;
    if (!input.customerId) throw new ForbiddenException('Login talab qilinadi');
    if (!/^[1-9]\d{0,18}$/.test(String(input.orderId))) {
      throw new NotFoundException('Buyurtma topilmadi');
    }
    const comment = dto.comment?.trim() || null;
    if (dto.reason === ReturnReason.OTHER && !comment) {
      throw new BadRequestException('“Boshqa” sababi uchun izoh yozing');
    }
    const itemIds = dto.items.map((item) => String(item.orderItemId));
    if (new Set(itemIds).size !== itemIds.length) {
      throw new BadRequestException('Bir tovar ro‘yxatda ikki marta berilgan');
    }

    const created = await this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `return-order:${input.orderId}`,
      ]);
      await this.assertOrderReturnable(
        manager,
        input.orderId,
        input.customerId,
      );
      const rows = await this.orderItems(manager, input.orderId, itemIds);
      const groups = new Map<
        string,
        Array<{ row: OrderItemRow; qty: number }>
      >();
      for (const item of dto.items) {
        const row = rows.get(String(item.orderItemId));
        if (!row) {
          throw new BadRequestException(
            `#${item.orderItemId} tovar bu buyurtmaga tegishli emas`,
          );
        }
        this.assertItemReturnable(row, Number(item.quantity));
        const group = groups.get(row.sellerOrderId) ?? [];
        group.push({ row, qty: Number(item.quantity) });
        groups.set(row.sellerOrderId, group);
      }

      const ids: string[] = [];
      for (const [sellerOrderId, lines] of groups) {
        const requested = lines.reduce(
          (sum, line) => sum + line.row.unitPrice * line.qty,
          0,
        );
        const [request] = (await manager.query(
          `INSERT INTO checkout.return_request
             (sales_order_id,sales_order_seller_id,shop_id,customer_id,
              status,reason,comment,requested_amount)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id::text`,
          [
            input.orderId,
            sellerOrderId,
            lines[0].row.shopId,
            input.customerId,
            S.SUBMITTED,
            dto.reason,
            comment,
            Math.round(requested * 100) / 100,
          ],
        )) as Array<{ id: string }>;
        for (const line of lines) {
          await manager.query(
            `INSERT INTO checkout.return_request_item
               (return_request_id,sales_order_item_id,quantity,unit_price,line_total)
             VALUES($1,$2,$3,$4,$5)`,
            [
              request.id,
              line.row.orderItemId,
              line.qty,
              line.row.unitPrice,
              Math.round(line.row.unitPrice * line.qty * 100) / 100,
            ],
          );
        }
        await writeReturnHistory(manager, {
          returnId: request.id,
          from: null,
          to: S.SUBMITTED,
          actor: { id: input.customerId, role: 'BUYER' },
          comment,
        });
        ids.push(request.id);
      }
      return this.queries.findMany(manager, ids);
    });

    for (const request of created) {
      await this.notifier.notify(
        {
          returnId: request.id,
          orderId: request.orderId,
          status: S.SUBMITTED,
          comment,
        },
        { shopId: request.shopId },
      );
    }
    return { items: created };
  }

  /**
   * Holat o'tishi. `shopId` berilsa (sotuvchi/operator) faqat o'z do'koni
   * so'rovi topiladi — begonasi 404.
   */
  async transition(
    kind: ReturnTransition,
    input: {
      returnId: string;
      actor: ReturnActor;
      shopId?: string;
      comment?: string | null;
    },
  ): Promise<ReturnRequestDetailsDto> {
    assertReturnId(input.returnId);
    const rule: TransitionRule = RULES[kind];
    const comment = input.comment?.trim() || null;
    if (rule.to === S.REJECTED && !comment) {
      throw new BadRequestException('Rad etish sababini yozing');
    }

    const changed = await this.dataSource.transaction(async (manager) => {
      const params: unknown[] = [input.returnId];
      let scope = '';
      if (input.shopId) {
        params.push(input.shopId);
        scope = ' AND shop_id=$2';
      }
      const [row] = (await manager.query(
        `SELECT id::text,status,shop_id::text AS "shopId",
                customer_id::text AS "customerId",
                sales_order_id::text AS "orderId"
           FROM checkout.return_request WHERE id=$1${scope} FOR UPDATE`,
        params,
      )) as Array<{
        id: string;
        status: ReturnRequestStatus;
        shopId: string;
        customerId: string;
        orderId: string;
      }>;
      if (!row) throw new NotFoundException('Qaytarish so‘rovi topilmadi');
      if (row.status === rule.to) return null;
      if (!rule.from.includes(row.status)) {
        throw new BadRequestException(
          `So‘rov ${row.status} holatida — ${rule.to} ga o‘tkazib bo‘lmaydi`,
        );
      }
      if (row.status === S.REJECTED && rule.to === S.APPROVED) {
        await this.assertStillAvailable(manager, row.id, row.orderId);
      }

      await manager.query(
        rule.decision
          ? `UPDATE checkout.return_request
                SET status=$2,decision_comment=$3,decided_by=$4,
                    decided_at=now(),updated_at=now()
              WHERE id=$1`
          : `UPDATE checkout.return_request SET status=$2,updated_at=now()
              WHERE id=$1`,
        rule.decision
          ? [row.id, rule.to, comment, input.actor.id]
          : [row.id, rule.to],
      );
      await writeReturnHistory(manager, {
        returnId: row.id,
        from: row.status,
        to: rule.to,
        actor: input.actor,
        comment,
      });
      return row;
    });

    if (changed) {
      await this.notifier.notify(
        {
          returnId: changed.id,
          orderId: changed.orderId,
          status: rule.to,
          comment,
        },
        // Admin sotuvchi qarorini o'zgartirsa sotuvchi ham bilsin.
        input.shopId
          ? { customerId: changed.customerId }
          : { customerId: changed.customerId, shopId: changed.shopId },
      );
    }
    return this.queries.get(input.returnId, { shopId: input.shopId });
  }

  private async assertOrderReturnable(
    manager: EntityManager,
    orderId: string,
    customerId: string,
  ): Promise<void> {
    const [order] = (await manager.query(
      `SELECT customer_id::text AS "customerId",status
         FROM checkout.sales_order WHERE id=$1`,
      [orderId],
    )) as Array<{ customerId: string; status: string }>;
    if (!order) throw new NotFoundException('Buyurtma topilmadi');
    if (String(order.customerId) !== String(customerId)) {
      throw new ForbiddenException('Bu buyurtmani ko‘rishga ruxsat yo‘q');
    }
    if (['CANCELLED', 'REFUNDED'].includes(order.status)) {
      throw new BadRequestException(
        'Bekor qilingan yoki to‘liq qaytarilgan buyurtmani qaytarib bo‘lmaydi',
      );
    }
  }

  /**
   * Buyurtma tovarlari + posilka holati + DELIVERED sanasi + boshqa (rad
   * etilmagan) so'rovlarda band qilingan miqdor.
   */
  private async orderItems(
    manager: EntityManager,
    orderId: string,
    itemIds: string[],
  ): Promise<Map<string, OrderItemRow>> {
    const rows = (await manager.query(
      `SELECT i.id::text AS "orderItemId",
              s.id::text AS "sellerOrderId", s.shop_id::text AS "shopId",
              s.status AS "sellerOrderStatus", i.quantity,
              i.unit_price::float8 AS "unitPrice",
              (SELECT MIN(h.created_at)
                 FROM checkout.sales_order_seller_history h
                WHERE h.sales_order_seller_id=s.id AND h.status='DELIVERED'
              ) AS "deliveredAt",
              s.updated_at AS "sellerOrderUpdatedAt",
              COALESCE((
                SELECT SUM(ri.quantity)
                  FROM checkout.return_request_item ri
                  JOIN checkout.return_request r ON r.id=ri.return_request_id
                 WHERE ri.sales_order_item_id=i.id AND r.status<>'REJECTED'
              ),0)::int AS "reservedQuantity"
         FROM checkout.sales_order_item i
         JOIN checkout.sales_order_seller s ON s.id=i.sales_order_seller_id
        WHERE s.sales_order_id=$1 AND i.id=ANY($2::bigint[])`,
      [orderId, itemIds],
    )) as OrderItemRow[];
    return new Map(rows.map((row) => [String(row.orderItemId), row]));
  }

  private assertItemReturnable(row: OrderItemRow, quantity: number): void {
    if (row.sellerOrderStatus !== SalesOrderSellerStatus.DELIVERED) {
      throw new BadRequestException(
        'Faqat yetkazib berilgan posilkadagi tovarni qaytarish mumkin',
      );
    }
    // Eski posilkalarda DELIVERED tarixi bo'lmasligi mumkin — unda holat
    // oxirgi o'zgargan sana olinadi.
    const deliveredAt = new Date(row.deliveredAt ?? row.sellerOrderUpdatedAt);
    if (Date.now() > deliveredAt.getTime() + this.windowDays * DAY_MS) {
      throw new BadRequestException(
        `Qaytarish muddati (${this.windowDays} kun) o‘tgan`,
      );
    }
    const available = Number(row.quantity) - Number(row.reservedQuantity);
    if (quantity > available) {
      throw new BadRequestException(
        `#${row.orderItemId} tovardan ko‘pi bilan ${Math.max(0, available)} dona qaytarish mumkin`,
      );
    }
  }

  /** Rad etilgan so'rov qayta tasdiqlansa, tovar boshqa so'rovga band bo'lmasin. */
  private async assertStillAvailable(
    manager: EntityManager,
    returnId: string,
    orderId: string,
  ): Promise<void> {
    await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      `return-order:${orderId}`,
    ]);
    const conflicts = (await manager.query(
      `SELECT ri.sales_order_item_id::text AS "orderItemId"
         FROM checkout.return_request_item ri
         JOIN checkout.sales_order_item i ON i.id=ri.sales_order_item_id
        WHERE ri.return_request_id=$1
          AND ri.quantity > i.quantity - COALESCE((
                SELECT SUM(x.quantity)
                  FROM checkout.return_request_item x
                  JOIN checkout.return_request r ON r.id=x.return_request_id
                 WHERE x.sales_order_item_id=ri.sales_order_item_id
                   AND r.status<>'REJECTED' AND r.id<>$1
              ),0)`,
      [returnId],
    )) as Array<{ orderItemId: string }>;
    if (conflicts.length) {
      throw new ConflictException(
        'Bu tovarlar uchun boshqa qaytarish so‘rovi mavjud',
      );
    }
  }
}
