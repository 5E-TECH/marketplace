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
  LEAD_RETURNABLE,
  LeadOrderStatus,
  ORDER_EVENTS,
  OrderReturnedEvent,
  OutboxService,
  ReturnReason,
  ReturnRequestDetailsDto,
  ReturnRequestItemInputDto,
  ReturnRequestStatus,
} from '@app/common';
import {
  AppliedTransition,
  LeadOrderStatusService,
  TransitionRejected,
} from './lead-order-status.service';
import { ReturnActor, writeReturnHistory } from './return-history';
import {
  assertReturnId,
  ReturnRequestQueryService,
} from './return-request-query.service';

const ID = /^[1-9]\d{0,18}$/;
const S = ReturnRequestStatus;
const BAD_LINE = 'items tovar qatori noto‘g‘ri yoki takrorlangan';

/**
 * So‘rov qatorlari buyurtma qatoriga: `orderItemId` yoki (FE-26) `productId` — mahsulot buyurtmada bitta qatorda bo‘lsa.
 * Bir qator ikki marta — 400.
 */
function orderLines(
  requested: ReturnRequestItemInputDto[],
  items: Array<{ id: string; productId: string }>,
): Array<{ orderItemId: string; quantity: number }> {
  const seen = new Set<string>();
  return requested.map((line) => {
    let id = line.orderItemId ? String(line.orderItemId) : null;
    if (!id) {
      const same = items.filter(
        (item) => item.productId === String(line.productId),
      );
      if (same.length !== 1)
        throw new BadRequestException({
          message: [
            same.length
              ? `items mahsulot ${line.productId} buyurtmada bir necha qatorda — orderItemId yuboring`
              : `items mahsulot ${line.productId} bu buyurtmada yo‘q`,
          ],
        });
      id = same[0].id;
    }
    if (seen.has(id)) throw new BadRequestException({ message: [BAD_LINE] });
    seen.add(id);
    return { orderItemId: id, quantity: line.quantity };
  });
}

/**
 * BE-44: yetkazilgandan keyin qaytarish (TZ T5, MOL-4, 2.5-4). Mijoz qo‘ng‘iroq qiladi — so‘rovni xodim (admin,
 * superadmin, operator, nazoratchi) mijoz nomidan kiritadi: «Yetkazildi» yoki «Pul o‘tkazildi» buyurtma (Elchi pulni
 * odatda bir-ikki kunda o‘tkazadi — QA-02), EQ-10 dagi qaytarish muddati ichida, sabab bilan. Buyurtma RETURN_REQUESTED;
 * tasdiqlansa — RETURNING (tovar BE-17 saralashiga) va `order.returned` bir marta (moliya teskari yozuvlari, BE-22);
 * rad etilsa — avvalgi holatga: Elchi pulni o‘tkazgan bo‘lsa REMITTED, aks holda DELIVERED [taklif]. Qaror yakuniy [taklif].
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
    const requested = Array.isArray(dto.items) ? dto.items : [];
    if (!requested.length)
      throw new BadRequestException({ message: ['items tovar tanlanmagan'] });
    for (const line of requested)
      if (
        !ID.test(String(line?.orderItemId ?? line?.productId ?? '')) ||
        !Number.isSafeInteger(line.quantity) ||
        line.quantity < 1
      )
        throw new BadRequestException({ message: [BAD_LINE] });

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
      // TC3: faqat yetkazilgan — «Yetkazildi» yoki «Pul o‘tkazildi» (QA-02)
      if (!LEAD_RETURNABLE.includes(order.status))
        throw new BadRequestException(
          `Buyurtma ${order.status} holatida — qaytarish so‘rovi faqat yetkazilgan buyurtmaga («Yetkazildi» yoki «Pul o‘tkazildi»)`,
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
        `SELECT i.id::text, i.product_id::text AS "productId", i.quantity, i.unit_price::text AS "unitPrice",
                p.id::text AS "parcelId", p.shop_id::text AS "shopId"
           FROM checkout.sales_order_item i
           JOIN checkout.parcel p ON p.id = i.sales_order_seller_id
          WHERE p.sales_order_id = $1`,
        [orderId],
      )) as Array<{
        id: string;
        productId: string;
        quantity: number;
        unitPrice: string;
        parcelId: string;
        shopId: string;
      }>;
      const byId = new Map(items.map((item) => [item.id, item]));
      const lines = orderLines(requested, items);
      // Hozircha faqat to‘liq qaytarish: moliya qisman qaytarishni yozmaydi (BE-22 `recordReturn`), ombor saralashi
      // hamma donani talab qiladi (BE-17) [taklif — qisman qaytarish alohida karta]
      if (
        lines.length !== items.length ||
        lines.some(
          (line) =>
            Number(byId.get(String(line.orderItemId))?.quantity) !==
            line.quantity,
        )
      )
        throw new BadRequestException({
          message: [
            'items hozircha faqat to‘liq qaytarish: buyurtmadagi hamma tovar, to‘liq soni bilan',
          ],
        });
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
    try {
      await this.decideIn(input, to, comment, (value) => (applied = value));
    } catch (error) {
      // BUY-2: rad etilgan holat o‘tishi ham jurnalda
      if (error instanceof TransitionRejected)
        await this.status.recordRejected(
          error,
          this.orderActor(input.actor),
          comment,
        );
      throw error;
    }
    await this.status.sendInventoryNow(
      (applied as AppliedTransition | null)?.command ?? null,
    );
    return this.queries.get(input.returnId);
  }

  private decideIn(
    input: { returnId: string; approve: boolean; actor: ReturnActor },
    to: ReturnRequestStatus,
    comment: string | null,
    onApplied: (applied: AppliedTransition) => void,
  ): Promise<void> {
    return this.dataSource.transaction(async (manager) => {
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
      // buyurtma qulfi rad etishdagi holat hisobidan OLDIN: Elchi «to‘landi» xabari shu paytda yozilayotgan bo‘lsa,
      // u commit bo‘lgach ko‘riladi (aks holda to‘langan buyurtma «Yetkazildi» ga tushardi)
      await manager.query(
        `SELECT 1 FROM checkout.sales_order WHERE id = $1 FOR UPDATE`,
        [row.orderId],
      );
      const applied = await this.status.applyTransition(manager, {
        orderId: row.orderId,
        returnDecision: true,
        to: input.approve
          ? LeadOrderStatus.RETURNING
          : await this.statusAfterRejection(manager, row.orderId),
        actor: this.orderActor(input.actor),
        reason: input.approve
          ? `Qaytarish tasdiqlandi (#${row.id})`
          : `Qaytarish rad etildi (#${row.id}): ${comment}`,
      });
      onApplied(applied);
      if (input.approve)
        await this.enqueueReturned(manager, row.id, row.orderId);
    });
  }

  /**
   * Rad etilgan so‘rovdan keyingi holat — so‘rovdan oldingi holat (tarixdagi oxirgi qabul qilingan `→ RETURN_REQUESTED`
   * o‘tishining `from`), so‘rov ochiq turganda Elchi «to‘landi» puli yozilgan bo‘lsa — REMITTED (webhook bu paytda
   * holatni o‘zgartirmay pulni moliyaga yozgan). Chaqiruvchi buyurtma qatorini qulflagan.
   */
  private async statusAfterRejection(
    manager: EntityManager,
    orderId: string,
  ): Promise<LeadOrderStatus> {
    const [row] = (await manager.query(
      `SELECT (SELECT h.from_status FROM checkout.order_status_history h
                WHERE h.order_id = $1::bigint AND h.to_status = 'RETURN_REQUESTED' AND h.accepted = TRUE
                ORDER BY h.id DESC LIMIT 1) AS "before",
              EXISTS (SELECT 1 FROM checkout.elchi_webhook_event w
                       WHERE w.order_id = $1::bigint AND w.status = 'paid' AND w.result <> 'REJECTED') AS paid`,
      [orderId],
    )) as Array<{ before: LeadOrderStatus | null; paid: boolean }>;
    if (row?.paid) return LeadOrderStatus.REMITTED;
    return row?.before && LEAD_RETURNABLE.includes(row.before)
      ? row.before
      : LeadOrderStatus.DELIVERED;
  }

  /** EQ-10 muddati: oxirgi «Yetkazildi» o‘tishidan. TC2: muddat o‘tgan — 400. */
  private async assertWithinWindow(
    manager: EntityManager,
    orderId: string,
  ): Promise<void> {
    const [row] = (await manager.query(
      // birinchi yetkazilish (rad etilgan so‘rovdan DELIVERED ga qaytish muddatni yangilamasin)
      `SELECT min(created_at) AS at FROM checkout.order_status_history
        WHERE order_id = $1 AND to_status = 'DELIVERED' AND accepted = TRUE
          AND from_status IS DISTINCT FROM 'RETURN_REQUESTED'`,
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
