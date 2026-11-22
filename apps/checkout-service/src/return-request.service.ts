import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager } from 'typeorm';
import { ReturnRequestDetailsDto, ReturnRequestStatus } from '@app/common';
import {
  assertReturnId,
  ReturnRequestQueryService,
} from './return-request-query.service';
import { ReturnNotifierService } from './return-notifier.service';
import { ReturnActor, writeReturnHistory } from './return-history';

interface TransitionRule {
  to: ReturnRequestStatus;
  from: ReturnRequestStatus[];
  /** Qaror (approve/reject) — decision_* ustunlari yangilanadi. */
  decision: boolean;
}

const S = ReturnRequestStatus;

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
