import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager } from 'typeorm';
import {
  CreateReturnRequestDto,
  ErrorCode,
  LeadOrderActorType,
  LeadOrderStatus,
  ORDER_EVENTS,
  OrderReturnedEvent,
  OutboxService,
  ReturnReason,
  ReturnRequestDetailsDto,
  ReturnRequestStatus,
} from '@app/common';
import {
  AppliedTransition,
  LeadOrderStatusService,
} from './lead-order-status.service';
import { ReturnActor, writeReturnHistory } from './return-history';
import {
  assertReturnId,
  ReturnRequestQueryService,
} from './return-request-query.service';

const ID = /^[1-9]\d{0,18}$/;
const S = ReturnRequestStatus;

/**
 * BE-44: yetkazilgandan keyin qaytarish (TZ T5, MOL-4, 2.5-4). Mijoz qo‘ng‘iroq qiladi — so‘rovni xodim (admin,
 * superadmin, operator, nazoratchi) mijoz nomidan kiritadi: faqat «Yetkazildi» buyurtma, EQ-10 dagi qaytarish muddati
 * ichida, sabab bilan. Buyurtma RETURN_REQUESTED; tasdiqlansa — RETURNING (tovar BE-17 saralashiga) va `order.returned`
 * bir marta (moliya teskari yozuvlari, BE-22); rad etilsa — DELIVERED ga qaytadi [taklif]. Qaror yakuniy [taklif].
 */
@Injectable()
export class LeadReturnService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
    private readonly status: LeadOrderStatusService,
    private readonly outbox: OutboxService,
    private readonly queries: ReturnRequestQueryService,
  ) {}

  /** Qaytarish muddati, kun — yetkazilgan paytdan (EQ-10; eski xaridor so‘rovlari bilan bir sozlama). */
  windowDays(): number {
    return Number(this.config.get('RETURN_WINDOW_DAYS') ?? 10);
  }

  async create(input: {
    orderId: string;
    dto: CreateReturnRequestDto;
    actor: ReturnActor;
  }): Promise<ReturnRequestDetailsDto> {
    const orderId = String(input?.orderId ?? '');
    if (!ID.test(orderId)) throw new NotFoundException('Buyurtma topilmadi');
    const dto = input.dto;
    if (!Object.values(ReturnReason).includes(dto?.reason))
      throw new BadRequestException({ message: ['reason sabab majburiy'] });
    const comment = dto.comment?.trim() || null;
    if (dto.reason === ReturnReason.OTHER && !comment)
      throw new BadRequestException({
        message: ['comment «Boshqa» sababida izoh majburiy'],
      });
    const lines = Array.isArray(dto.items) ? dto.items : [];
    if (!lines.length)
      throw new BadRequestException({ message: ['items tovar tanlanmagan'] });
    const seen = new Set<string>();
    for (const line of lines) {
      const id = String(line?.orderItemId ?? '');
      if (
        !ID.test(id) ||
        seen.has(id) ||
        !Number.isSafeInteger(line.quantity) ||
        line.quantity < 1
      )
        throw new BadRequestException({
          message: ['items tovar qatori noto‘g‘ri yoki takrorlangan'],
        });
      seen.add(id);
    }

    let applied: AppliedTransition | null = null;
    const returnId = await this.dataSource.transaction(async (manager) => {
      const [order] = (await manager.query(
        `SELECT id::text, status, lead_id::text AS "leadId"
           FROM checkout.sales_order WHERE id = $1 FOR UPDATE`,
        [orderId],
      )) as Array<{
        id: string;
        status: LeadOrderStatus;
        leadId: string | null;
      }>;
      if (!order) throw new NotFoundException('Buyurtma topilmadi');
      if (!order.leadId)
        throw new BadRequestException(
          'Qaytarish so‘rovi faqat liddan buyurtmaga',
        );
      // TC3: faqat «Yetkazildi»
      if (order.status !== LeadOrderStatus.DELIVERED)
        throw new BadRequestException(
          `Buyurtma ${order.status} holatida — qaytarish so‘rovi faqat «Yetkazildi» buyurtmaga`,
        );
      await this.assertWithinWindow(manager, orderId);
      const [active] = (await manager.query(
        `SELECT id::text FROM checkout.return_request
          WHERE sales_order_id = $1 AND status IN ('SUBMITTED', 'IN_REVIEW') LIMIT 1`,
        [orderId],
      )) as Array<{ id: string }>;
      if (active)
        throw new ConflictException({
          message: `Bu buyurtmada ochiq qaytarish so‘rovi bor (#${active.id})`,
          errorCode: ErrorCode.INVALID_STATE,
        });

      const items = (await manager.query(
        `SELECT i.id::text, i.quantity, i.unit_price::text AS "unitPrice",
                p.id::text AS "parcelId", p.shop_id::text AS "shopId"
           FROM checkout.sales_order_item i
           JOIN checkout.parcel p ON p.id = i.sales_order_seller_id
          WHERE p.sales_order_id = $1`,
        [orderId],
      )) as Array<{
        id: string;
        quantity: number;
        unitPrice: string;
        parcelId: string;
        shopId: string;
      }>;
      const byId = new Map(items.map((item) => [item.id, item]));
      let amount = 0n;
      for (const line of lines) {
        const item = byId.get(String(line.orderItemId));
        if (!item)
          throw new BadRequestException({
            message: [`items ${line.orderItemId} bu buyurtmada yo‘q`],
          });
        if (line.quantity > Number(item.quantity))
          throw new BadRequestException({
            message: [
              `items ${line.orderItemId}: ${item.quantity} donadan ko‘p`,
            ],
          });
        amount += BigInt(item.unitPrice) * BigInt(line.quantity);
      }
      const parcel = items[0];
      const [created] = (await manager.query(
        `INSERT INTO checkout.return_request
           (sales_order_id, sales_order_seller_id, shop_id, customer_id, status, reason, comment,
            requested_amount, source, created_by)
         VALUES ($1, $2, $3, NULL, $4, $5, $6, $7, 'STAFF', $8)
         RETURNING id::text`,
        [
          orderId,
          parcel.parcelId,
          parcel.shopId,
          S.SUBMITTED,
          dto.reason,
          comment,
          amount.toString(),
          input.actor.id,
        ],
      )) as Array<{ id: string }>;
      for (const line of lines) {
        const item = byId.get(String(line.orderItemId))!;
        await manager.query(
          `INSERT INTO checkout.return_request_item
             (return_request_id, sales_order_item_id, quantity, unit_price, line_total)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            created.id,
            item.id,
            line.quantity,
            item.unitPrice,
            (BigInt(item.unitPrice) * BigInt(line.quantity)).toString(),
          ],
        );
      }
      // TC1: tarixda kiritgan xodim
      await writeReturnHistory(manager, {
        returnId: created.id,
        from: null,
        to: S.SUBMITTED,
        actor: input.actor,
        comment: comment ?? 'Xodim mijoz nomidan kiritdi',
      });
      applied = await this.status.applyTransition(manager, {
        orderId,
        to: LeadOrderStatus.RETURN_REQUESTED,
        actor: this.orderActor(input.actor),
        reason: `Qaytarish so‘rovi #${created.id}`,
      });
      return created.id;
    });
    await this.status.sendInventoryNow(
      (applied as AppliedTransition | null)?.command ?? null,
    );
    return this.queries.get(returnId);
  }

  /** Xodim so‘rovimi (STAFF) — admin qarori shu yerda; eski xaridor so‘rovlari eski tartibda. */
  async isStaffRequest(returnId: string): Promise<boolean> {
    assertReturnId(returnId);
    const [row] = (await this.dataSource.query(
      `SELECT source FROM checkout.return_request WHERE id = $1`,
      [returnId],
    )) as Array<{ source: string }>;
    return row?.source === 'STAFF';
  }

  /**
   * Admin qarori. Tasdiq — buyurtma RETURNING va `order.returned` (TC4: bir marta; moliya hodisa ID si bo‘yicha
   * takrorni tashlaydi — TC5). Rad — buyurtma DELIVERED, sabab majburiy. Qaror yakuniy: boshqa qaror — 409; o‘sha
   * qaror takror — o‘sha natija.
   */
  async decide(input: {
    returnId: string;
    approve: boolean;
    actor: ReturnActor;
    comment?: string | null;
  }): Promise<ReturnRequestDetailsDto> {
    assertReturnId(input.returnId);
    const to = input.approve ? S.APPROVED : S.REJECTED;
    const comment = input.comment?.trim() || null;
    if (!input.approve && !comment)
      throw new BadRequestException('Rad etish sababini yozing');
    let applied: AppliedTransition | null = null;
    await this.dataSource.transaction(async (manager) => {
      const [row] = (await manager.query(
        `SELECT id::text, status, source, sales_order_id::text AS "orderId"
           FROM checkout.return_request WHERE id = $1 FOR UPDATE`,
        [input.returnId],
      )) as Array<{
        id: string;
        status: ReturnRequestStatus;
        source: string;
        orderId: string;
      }>;
      if (!row || row.source !== 'STAFF')
        throw new NotFoundException('Qaytarish so‘rovi topilmadi');
      if (row.status === to) return;
      if (row.status !== S.SUBMITTED && row.status !== S.IN_REVIEW)
        throw new ConflictException({
          message: `So‘rov ${row.status} — qaror berilgan`,
          errorCode: ErrorCode.INVALID_STATE,
        });
      await manager.query(
        `UPDATE checkout.return_request
            SET status = $2, decision_comment = $3, decided_by = $4, decided_at = now(), updated_at = now()
          WHERE id = $1`,
        [row.id, to, comment, input.actor.id],
      );
      await writeReturnHistory(manager, {
        returnId: row.id,
        from: row.status,
        to,
        actor: input.actor,
        comment,
      });
      applied = await this.status.applyTransition(manager, {
        orderId: row.orderId,
        to: input.approve
          ? LeadOrderStatus.RETURNING
          : LeadOrderStatus.DELIVERED,
        actor: this.orderActor(input.actor),
        reason: input.approve
          ? `Qaytarish tasdiqlandi (#${row.id})`
          : `Qaytarish rad etildi (#${row.id}): ${comment}`,
      });
      if (input.approve)
        await this.enqueueReturned(manager, row.id, row.orderId);
    });
    await this.status.sendInventoryNow(
      (applied as AppliedTransition | null)?.command ?? null,
    );
    return this.queries.get(input.returnId);
  }

  /** EQ-10 muddati: oxirgi «Yetkazildi» o‘tishidan. TC2: muddat o‘tgan — 400. */
  private async assertWithinWindow(
    manager: EntityManager,
    orderId: string,
  ): Promise<void> {
    const [row] = (await manager.query(
      `SELECT max(created_at) AS at FROM checkout.order_status_history
        WHERE order_id = $1 AND to_status = 'DELIVERED' AND accepted = TRUE`,
      [orderId],
    )) as Array<{ at: Date | null }>;
    if (!row?.at) throw new BadRequestException('Yetkazilgan vaqti topilmadi');
    const days = this.windowDays();
    if (Date.now() > new Date(row.at).getTime() + days * 24 * 60 * 60 * 1000)
      throw new BadRequestException(`Qaytarish muddati (${days} kun) o‘tgan`);
  }

  private async enqueueReturned(
    manager: EntityManager,
    returnId: string,
    orderId: string,
  ): Promise<void> {
    const items = (await manager.query(
      `SELECT i.product_id::text AS "productId", r.quantity
         FROM checkout.return_request_item r
         JOIN checkout.sales_order_item i ON i.id = r.sales_order_item_id
        WHERE r.return_request_id = $1
        ORDER BY r.id`,
      [returnId],
    )) as Array<{ productId: string; quantity: number }>;
    const event: OrderReturnedEvent = {
      // bir so‘rovga bitta hodisa — moliya `eventId` bo‘yicha takrorni tashlaydi
      eventId: `order.returned:${returnId}`,
      orderId,
      returnRequestId: returnId,
      items: items.map((item) => ({
        productId: item.productId,
        quantity: Number(item.quantity),
      })),
      occurredAt: new Date().toISOString(),
    };
    await this.outbox.record(
      {
        aggregateType: 'sales_order',
        aggregateId: orderId,
        eventType: ORDER_EVENTS.RETURNED,
        payload: event as unknown as Record<string, unknown>,
      },
      manager,
    );
  }

  private orderActor(actor: ReturnActor) {
    return {
      type: LeadOrderActorType.USER,
      id: String(actor.id),
      role: actor.role ?? null,
    };
  }
}
