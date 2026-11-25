import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom, timeout } from 'rxjs';
import { DataSource, QueryFailedError } from 'typeorm';
import {
  ELCHI_CHECK_RPC,
  ELCHI_STATUS_ALIASES,
  ElchiRefreshDto,
  ElchiResendDto,
  ElchiShipmentsStatusResult,
  elchiOrderRef,
  ElchiWebhookDto,
  ErrorCode,
  LabelReprintDto,
  LeadOrderStatus,
  LeadRegionGroupDto,
  ORDER_EVENTS,
  OrderDisputeClosedDto,
  OrderDisputeDto,
  OrderExportChunkInput,
  OrderExportColumn,
  OrderExportFilterDto,
  OrderViewer,
  ParcelElchiState,
  RmqClient,
  sendRpc,
  tashkentDate,
  UserNamesClient,
} from '@app/common';
import { ElchiLeadWebhookService } from './elchi-lead-webhook.service';
import {
  leadOrderNumber,
  LeadOrderStatusService,
} from './lead-order-status.service';
import {
  AdminOrderListQuery,
  AdminOrderRow,
  maskPhone,
  SellerOrdersService,
} from './seller-orders.service';

const ID = /^[1-9]\d{0,18}$/;
/** Nomlar — ko‘rinish ma’lumoti: javob bo‘lmasa ro‘yxat kod yoki bo‘sh nom bilan ochiladi [taklif]. */
const NAMES_TIMEOUT_MS = 1_500;
const EXPORT_CHUNK = 1_000;
/** TEL-6: nizoli buyurtmaning qo‘ng‘iroq yozuvi 1 yil saqlanadi. */
const DISPUTE_KEEP_YEARS = 1;
const OPEN_DISPUTE_INDEX = 'uq_checkout_order_dispute_open';
/** Posilkani qayta yuborish mumkin bo‘lgan holatlar: Elchi’ga topshirilgunga qadar. */
const BEFORE_HANDOVER: string[] = [
  LeadOrderStatus.CONFIRMED,
  LeadOrderStatus.PICKING,
  LeadOrderStatus.PACKED,
];
/** Elchi’dan holatni so‘rash mumkin bo‘lgan holatlar: posilka Elchi’da, yakuni hali kelmagan. */
const AT_ELCHI: string[] = [
  LeadOrderStatus.HANDED_TO_ELCHI,
  LeadOrderStatus.IN_TRANSIT,
];
/** Pul holatlari so‘rov bilan qo‘llanmaydi — summalar webhook va kunlik tekshiruvda (BE-21, BE-46). */
const REFRESHABLE: ReadonlySet<string> = new Set([
  'on_the_road',
  'sold',
  'cancelled',
  'returned',
]);

const STATUS_LABELS: Record<string, string> = {
  CONFIRMED: 'Tasdiqlandi',
  PICKING: 'Yig‘ilmoqda',
  PACKED: 'Qadoqlandi',
  HANDED_TO_ELCHI: 'Elchi’ga topshirildi',
  IN_TRANSIT: 'Yo‘lda',
  DELIVERED: 'Yetkazildi',
  REMITTED: 'Pul o‘tkazildi',
  SETTLED: 'Yopildi',
  RETURN_REQUESTED: 'Qaytarish so‘raldi',
  REFUSED: 'Rad etildi',
  RETURNING: 'Qaytmoqda',
  RETURNED_GRADED: 'Qaytib keldi',
  CANCELLED: 'Bekor qilindi',
};

const CSV_HEADER: Record<OrderExportColumn, string[]> = {
  [OrderExportColumn.ORDER]: ['Buyurtma', 'Lid', 'Yaratildi (Toshkent)'],
  [OrderExportColumn.CUSTOMER]: ['Mijoz', 'Viloyat'],
  [OrderExportColumn.PHONE]: ['Telefon'],
  [OrderExportColumn.STREAM]: ['Sahifa'],
  [OrderExportColumn.SOURCE]: ['Manba'],
  [OrderExportColumn.AMOUNT]: ['Summa, so‘m', 'Yetkazish, so‘m'],
  [OrderExportColumn.STATUS]: ['Holat'],
  [OrderExportColumn.TRACK]: ['Elchi treki'],
  // narx nusxasi — birinchi tovar qatorining bir donasi
  [OrderExportColumn.PRICE_SNAPSHOT]: [
    'Optovik narxi',
    'Tavsiya narxi',
    'Tasdiqlangan narx',
    'Ustama',
    'Sotuvchi haqi',
    'Qo‘ng‘iroq markazi',
    'Yashirilgan yetkazish',
    'Platforma xizmati',
  ],
  [OrderExportColumn.SUBS]: ['Sub'],
};

/** CSV katagi: formula bo‘lib ochilmasin; «;», qo‘shtirnoq va qator ko‘chishi qo‘shtirnoqda. */
export const csvCell = (value: string): string => {
  const v = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[;"\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
};

const two = (n: number) => String(n).padStart(2, '0');
/** «T-0231» — topshirish akti (dizayn). */
const actCode = (id: string) => `T-${id.padStart(4, '0')}`;

/** «ertangi to‘lqin», «bugungi to‘lqin», «16.01 to‘lqini» — tasdiqlangan buyurtma qaysi kuni jo‘natiladi. */
export function waveText(pickDate: string | null, now: Date): string | null {
  if (!pickDate) return null;
  const today = tashkentDate(now);
  const tomorrow = tashkentDate(new Date(now.getTime() + 24 * 3_600_000));
  if (pickDate === today) return 'bugungi to‘lqin';
  if (pickDate === tomorrow) return 'ertangi to‘lqin';
  const [, month, day] = pickDate.split('-');
  return `${day}.${month} to‘lqini`;
}

type NameOf = (id: string) => string;

/** Eksport filtri → ro‘yxat filtri: `from`/`to` frontend nomi; saralash va sahifalash qo‘llanmaydi. */
function exportQuery(filters: OrderExportFilterDto): AdminOrderListQuery {
  const { from, to, sort: _sort, ...rest } = filters ?? {};
  return {
    ...rest,
    dateFrom: rest.dateFrom ?? from,
    dateTo: rest.dateTo ?? to,
  };
}

/**
 * Buyurtmalar admin, nazoratchi va operatorga (BE-18; FE-26 — BE-25). Kim nimani ko‘radi (TZ 3, dizayn admin-buyurtmalar,
 * nazoratchi-buyurtmalar, operator-buyurtmalarim):
 * - admin, superadmin — hammasi, kartada to‘liq telefon;
 * - nazoratchi — lid buyurtmalari, telefon niqoblangan, narx tarkibi (optovik narxi, haqlar) yo‘q;
 * - operator — faqat o‘zi tasdiqlagan buyurtmalar, sotuvchi va sahifa ko‘rinmaydi.
 */
@Injectable()
export class AdminOrdersService {
  private readonly logger = new Logger(AdminOrdersService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly orders: SellerOrdersService,
    private readonly statuses: LeadOrderStatusService,
    private readonly webhook: ElchiLeadWebhookService,
    @Inject(RmqClient.INTEGRATION) private readonly integration: ClientProxy,
    @Inject(RmqClient.LEAD) private readonly lead: ClientProxy,
    @Optional() private readonly names?: UserNamesClient,
  ) {}

  async list(
    query: AdminOrderListQuery,
    viewer: OrderViewer,
    now = new Date(),
  ) {
    const scoped = this.scope(query, viewer);
    const page = await this.orders.adminListOrders(scoped);
    const [nameOf, geo, codes, facets] = await Promise.all([
      this.namesOf(
        page.items.flatMap((i) => [
          viewer.kind === 'OPERATOR' ? null : i.affiliateId,
          i.confirmedById,
          i.statusActorId,
          i.pickedBy,
        ]),
      ),
      this.geo(page.items.some((i) => i.regionSoato)),
      viewer.kind === 'OPERATOR'
        ? new Map<string, string>()
        : this.streamCodes(page.items.map((i) => i.streamId)),
      viewer.kind === 'OPERATOR'
        ? this.orders.adminOrderProducts({
            leadOnly: true,
            confirmedById: viewer.userId,
          })
        : null,
    ]);
    const { items, ...rest } = page;
    return {
      ...rest,
      items: items.map((i) => this.row(i, viewer, { nameOf, geo, codes }, now)),
      ...(facets ? { facets: { products: facets } } : {}),
    };
  }

  async get(orderId: string, viewer: OrderViewer, now = new Date()) {
    const id = this.id(orderId);
    const order = await this.orders.adminGetOrder(id);
    const lead = order.lead;
    if (
      viewer.kind === 'OPERATOR' &&
      (!lead || lead.confirmedBy !== viewer.userId)
    )
      throw new NotFoundException(`Buyurtma #${id} topilmadi`);
    if (viewer.kind === 'SUPERVISOR' && !lead)
      throw new NotFoundException(`Buyurtma #${id} topilmadi`);
    if (!lead) return order; // eski do‘kon buyurtmasi — avvalgi shakl

    const [parcel, task, elchiEvents, returnRequest, dispute, reprint] =
      await Promise.all([
        this.one<{
          track: string | null;
          state: string | null;
          error: string | null;
          actId: string | null;
          actAt: Date | null;
          actCount: number | null;
        }>(
          `SELECT p.elchi_shipment_id::text AS track, p.elchi_state AS state, p.elchi_error AS error,
                  a.id::text AS "actId", a.created_at AS "actAt", a.parcel_count AS "actCount"
             FROM checkout.parcel p LEFT JOIN checkout.handover_act a ON a.id = p.handover_act_id
            WHERE p.sales_order_id = $1 ORDER BY (p.elchi_shipment_id IS NULL), p.id LIMIT 1`,
          [id],
        ),
        this.one<{
          status: string;
          pickDate: string;
          scanned: number;
          total: number;
          pickedBy: string | null;
          pickedAt: Date | null;
          packedAt: Date | null;
          barcode: string | null;
        }>(
          `SELECT t.status, t.pick_date::text AS "pickDate", t.picked_qty AS scanned, t.required_qty AS total,
                  t.picked_by::text AS "pickedBy", t.picked_at AS "pickedAt", t.packed_at AS "packedAt",
                  (SELECT i.barcode FROM checkout.sales_order_item i WHERE i.sales_order_seller_id = t.parcel_id
                    ORDER BY i.id LIMIT 1) AS barcode
             FROM checkout.fulfillment_task t WHERE t.order_id = $1`,
          [id],
        ),
        this.dataSource.query(
          `SELECT occurred_at AS at, status, result, detail FROM checkout.elchi_webhook_event
            WHERE order_id = $1 ORDER BY processed_at, event_id`,
          [id],
        ) as Promise<
          Array<{
            at: Date;
            status: string;
            result: string;
            detail: string | null;
          }>
        >,
        this.one<{ at: Date; by: string | null; reason: string }>(
          `SELECT created_at AS at, created_by::text AS by, reason FROM checkout.return_request
            WHERE sales_order_id = $1 ORDER BY id DESC LIMIT 1`,
          [id],
        ),
        this.openDispute(id),
        this.one<{ at: Date; by: string; count: number }>(
          `SELECT max(created_at) AS at, (array_agg(actor_id::text ORDER BY id DESC))[1] AS by, count(*)::int AS count
             FROM checkout.label_reprint WHERE order_id = $1 HAVING count(*) > 0`,
          [id],
        ),
      ]);
    const history = lead.statusHistory as Array<{
      toStatus: string;
      accepted: boolean;
      actorId: string | null;
      actorType: string;
      actorRole: string | null;
      reason: string | null;
      createdAt: Date;
    }>;
    const last = [...history]
      .reverse()
      .find((h) => h.accepted && h.toStatus === order.status);
    const [nameOf, geo, codes] = await Promise.all([
      this.namesOf([
        lead.affiliateId,
        lead.confirmedBy,
        lead.addressConfirmedBy,
        ...history.map((h) => h.actorId),
        task?.pickedBy,
        returnRequest?.by,
        dispute?.by,
        reprint?.by,
      ]),
      this.geo(true),
      this.streamCodes([lead.streamId]),
    ]);
    const actor = (h: (typeof history)[number]) =>
      h.actorId
        ? nameOf(h.actorId)
        : h.actorType === 'ELCHI'
          ? 'Elchi'
          : 'Tizim';
    const statusAt = last
      ? new Date(last.createdAt)
      : new Date(order.createdAt);
    const internal = viewer.kind === 'ADMIN';
    return {
      ...order,
      sellerOrders: internal
        ? order.sellerOrders
        : order.sellerOrders.map((s) => ({
            ...s,
            items: (s.items as Array<Record<string, unknown>>).map((i) => ({
              ...i,
              priceSnapshot: null,
            })),
          })),
      lead: {
        ...lead,
        customerPhone: internal ? lead.customerPhone : null,
        ...(viewer.kind === 'OPERATOR'
          ? { affiliateId: null, streamId: null, wholesalerId: null }
          : {}),
        ...(internal
          ? {}
          : {
              deliveryCost: null,
              deliveryEmbedded: null,
            }),
        statusHistory: history.map((h) => ({ ...h, actorName: actor(h) })),
      },
      phoneMasked: lead.customerPhone
        ? maskPhone(String(lead.customerPhone))
        : null,
      statusAt: statusAt.toISOString(),
      statusDetail: this.detail(
        {
          status: String(order.status),
          pickDate: task?.pickDate ?? null,
          pickedBy: task?.pickedBy ?? null,
          actId: parcel?.actId ?? null,
          statusActorId: last?.actorId ?? null,
        },
        nameOf,
        now,
      ),
      shipDate: task?.pickDate ?? null,
      customer: {
        regionName: this.regionName(geo, String(lead.regionSoato)),
        districtName: this.districtName(
          geo,
          lead.regionSoato,
          lead.districtSoato,
        ),
        addressLine: order.deliveryAddress,
        // vaqti lid kartasidan (gateway to‘ldiradi)
        addressConfirmedBy: lead.addressConfirmedBy
          ? { name: nameOf(lead.addressConfirmedBy), at: null as string | null }
          : null,
      },
      stream:
        viewer.kind === 'OPERATOR' || !lead.streamId
          ? null
          : {
              code: codes.get(String(lead.streamId)) ?? null,
              affiliateName: lead.affiliateId ? nameOf(lead.affiliateId) : null,
              affiliateId: lead.affiliateId,
            },
      confirmedByActor: lead.confirmedBy
        ? {
            name: nameOf(lead.confirmedBy),
            at: new Date(order.createdAt).toISOString(),
          }
        : null,
      parcel: {
        track: parcel?.track ?? null,
        state: parcel?.state ?? null,
        error: internal ? (parcel?.error ?? null) : null,
        act: parcel?.actId
          ? {
              code: actCode(parcel.actId),
              at: new Date(parcel.actAt!).toISOString(),
              count: Number(parcel.actCount),
            }
          : null,
        label: reprint
          ? {
              printedAt: new Date(reprint.at).toISOString(),
              by: nameOf(reprint.by),
              count: Number(reprint.count),
            }
          : null,
        lastWebhookAt: elchiEvents.length
          ? new Date(elchiEvents[elchiEvents.length - 1].at).toISOString()
          : null,
      },
      elchiEvents: elchiEvents.map((e) => ({
        at: new Date(e.at).toISOString(),
        title: e.status,
        detail: e.detail,
        state: e.result === 'REJECTED' ? 'REJECTED' : 'ACCEPTED',
      })),
      picking: task
        ? {
            by: task.pickedBy ? nameOf(task.pickedBy) : null,
            wave: task.pickDate,
            from: task.pickedAt ? new Date(task.pickedAt).toISOString() : null,
            to: task.packedAt ? new Date(task.packedAt).toISOString() : null,
            scanned: Number(task.scanned),
            total: Number(task.total),
            barcode: task.barcode,
            cell: null,
            reservedAt: new Date(order.createdAt as string).toISOString(),
            releasedAt:
              order.status === LeadOrderStatus.CANCELLED
                ? statusAt.toISOString()
                : null,
          }
        : null,
      cancel:
        order.status === LeadOrderStatus.CANCELLED && last
          ? {
              by: actor(last),
              byRole: last.actorRole,
              at: statusAt.toISOString(),
              reason: last.reason ?? '',
            }
          : null,
      returnRequest: returnRequest
        ? {
            at: new Date(returnRequest.at).toISOString(),
            by: returnRequest.by ? nameOf(returnRequest.by) : null,
            reason: returnRequest.reason,
          }
        : null,
      dispute:
        dispute && viewer.kind !== 'OPERATOR'
          ? {
              at: dispute.at.toISOString(),
              by: nameOf(dispute.by),
              reason: dispute.reason,
              keepUntil: dispute.keepUntil.toISOString(),
            }
          : null,
    };
  }

  /** FE-26: yorliqni qayta chop etish sababi (PDF — mavjud yorliq endpointi). */
  async logReprint(
    orderId: string,
    actorId: string,
    reason: string,
  ): Promise<LabelReprintDto> {
    const id = this.id(orderId);
    const why = this.reason(reason);
    await this.leadOrder(id);
    await this.dataSource.query(
      `INSERT INTO checkout.label_reprint (order_id, actor_id, reason) VALUES ($1, $2, $3)`,
      [id, this.id(actorId), why],
    );
    const row = await this.one<{ at: Date; count: number }>(
      `SELECT max(created_at) AS at, count(*)::int AS count FROM checkout.label_reprint WHERE order_id = $1`,
      [id],
    );
    const nameOf = await this.namesOf([actorId]);
    return {
      printedAt: new Date(row!.at).toISOString(),
      by: nameOf(actorId),
      count: Number(row!.count),
    };
  }

  /**
   * «Nizoli» (TEL-6): qo‘ng‘iroq yozuvi 1 yil saqlanadigan muddat bilan belgilanadi. Bitta ochiq nizo; takror — 409.
   * Yozuvning o‘zi provayderda (EQ-02): muddatni uzaytirish provayder ulangach.
   */
  async openDisputeFor(
    orderId: string,
    actorId: string,
    reason: string,
    now = new Date(),
  ): Promise<OrderDisputeDto> {
    const id = this.id(orderId);
    const why = this.reason(reason);
    await this.leadOrder(id);
    const keepUntil = new Date(now);
    keepUntil.setUTCFullYear(keepUntil.getUTCFullYear() + DISPUTE_KEEP_YEARS);
    try {
      await this.dataSource.query(
        `INSERT INTO checkout.order_dispute (order_id, reason, opened_by, opened_at, keep_until)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, why, this.id(actorId), now, keepUntil],
      );
    } catch (error) {
      const driver = (error as QueryFailedError)?.driverError as
        { code?: string; constraint?: string } | undefined;
      if (driver?.code === '23505' && driver.constraint === OPEN_DISPUTE_INDEX)
        throw new ConflictException({
          message: 'Buyurtma allaqachon nizoli deb belgilangan',
          errorCode: ErrorCode.INVALID_STATE,
        });
      throw error;
    }
    const nameOf = await this.namesOf([actorId]);
    return {
      at: now.toISOString(),
      by: nameOf(actorId),
      reason: why,
      keepUntil: keepUntil.toISOString(),
    };
  }

  async closeDispute(
    orderId: string,
    actorId: string,
    comment: string | null,
    now = new Date(),
  ): Promise<OrderDisputeClosedDto> {
    const id = this.id(orderId);
    const result = (await this.dataSource.query(
      `UPDATE checkout.order_dispute SET closed_at = $2, closed_by = $3, close_comment = $4, updated_at = now()
        WHERE order_id = $1 AND closed_at IS NULL RETURNING id`,
      [id, now, this.id(actorId), comment?.trim() || null],
    )) as unknown[];
    const rows =
      result.length === 2 && Array.isArray(result[0]) ? result[0] : result;
    if (!(rows as unknown[]).length) {
      await this.leadOrder(id);
      throw new ConflictException({
        message: 'Ochiq nizo yo‘q',
        errorCode: ErrorCode.INVALID_STATE,
      });
    }
    return { orderId: id, closedAt: now.toISOString() };
  }

  /**
   * Elchi’ga qayta yuborish: posilka so‘rovi FAILED bo‘lsa, topshirilgunga qadar. Faqat Elchi integratsiyasi navbatiga
   * boradi (moliya, lid va SMS ga qayta hodisa ketmaydi). Avtomatik urinishlar cheksiz (BE-20) — bu Elchi rad etgan
   * (400/422) so‘rov uchun.
   */
  async resendToElchi(orderId: string): Promise<ElchiResendDto> {
    const id = this.id(orderId);
    return this.dataSource.transaction(async (manager) => {
      const [order] = (await manager.query(
        `SELECT o.status, p.id::text AS "parcelId", p.elchi_state AS state
           FROM checkout.sales_order o JOIN checkout.parcel p ON p.sales_order_id = o.id
          WHERE o.id = $1 AND o.source IS NOT NULL ORDER BY p.id LIMIT 1 FOR UPDATE OF o, p`,
        [id],
      )) as Array<{ status: string; parcelId: string; state: string | null }>;
      if (!order) throw new NotFoundException(`Buyurtma #${id} topilmadi`);
      if (
        order.state !== ParcelElchiState.FAILED ||
        !BEFORE_HANDOVER.includes(order.status)
      )
        throw new ConflictException({
          message:
            'Qayta yuborib bo‘lmaydi: posilka so‘rovi rad etilmagan yoki buyurtma topshirilgan',
          errorCode: ErrorCode.INVALID_STATE,
        });
      await manager.query(
        `UPDATE checkout.parcel SET elchi_state = 'PENDING', elchi_error = NULL, updated_at = now() WHERE id = $1`,
        [order.parcelId],
      );
      const event = await this.statuses.buildEvent(
        manager,
        id,
        null,
        LeadOrderStatus.CONFIRMED,
      );
      try {
        await firstValueFrom(
          this.integration
            .emit(ORDER_EVENTS.STATUS_CHANGED, event)
            .pipe(timeout(NAMES_TIMEOUT_MS)),
          { defaultValue: undefined },
        );
      } catch (error) {
        this.logger.warn(
          `Buyurtma ${id}: Elchi navbatiga yuborilmadi — ${(error as Error)?.message}`,
        );
        throw new ServiceUnavailableException(
          'Navbat javob bermadi — qayta urinib ko‘ring',
        );
      }
      return { orderId: id, elchiState: ParcelElchiState.PENDING };
    });
  }

  /**
   * «Elchi’dan holatni so‘rash» (webhook kelmagan posilka): Elchi’dagi holat BE-21 qoidasi bilan qo‘llanadi — faqat
   * oldinga. Pul holatlari (`paid`, `partly_paid`) qo‘llanmaydi: summalar webhook va kunlik tekshiruvda (BE-46).
   */
  async refreshFromElchi(
    orderId: string,
    now = new Date(),
  ): Promise<ElchiRefreshDto> {
    const id = this.id(orderId);
    const row = await this.one<{ status: string; shipmentId: string | null }>(
      `SELECT o.status, p.elchi_shipment_id::text AS "shipmentId"
         FROM checkout.sales_order o JOIN checkout.parcel p ON p.sales_order_id = o.id
        WHERE o.id = $1 AND o.source IS NOT NULL ORDER BY (p.elchi_shipment_id IS NULL), p.id LIMIT 1`,
      [id],
    );
    if (!row) throw new NotFoundException(`Buyurtma #${id} topilmadi`);
    if (!row.shipmentId || !AT_ELCHI.includes(row.status))
      throw new ConflictException({
        message: 'Posilka hozir Elchi’da emas',
        errorCode: ErrorCode.INVALID_STATE,
      });
    const result = await sendRpc<ElchiShipmentsStatusResult>(
      this.integration,
      { cmd: ELCHI_CHECK_RPC.SHIPMENTS_STATUS },
      { shipmentIds: [row.shipmentId] },
    );
    const item = result.items.find((i) => i.shipmentId === row.shipmentId);
    if (!item)
      throw new ServiceUnavailableException(
        result.notFound.includes(row.shipmentId)
          ? 'Elchi bu posilkani topmadi'
          : `Elchi javob bermadi: ${result.failed[0]?.error ?? 'noma’lum xato'}`,
      );
    const raw = item.status.trim().toLowerCase();
    const status = ELCHI_STATUS_ALIASES[raw];
    if (!status || !REFRESHABLE.has(status))
      return {
        orderId: id,
        elchiStatus: item.status,
        status: row.status,
        applied: false,
        detail: status
          ? 'Bu holat buyurtmaga so‘rov bilan qo‘llanmaydi (pul holati — webhook yoki kunlik tekshiruv)'
          : 'Noma’lum Elchi holati',
      };
    const outcome = await this.webhook.process({
      // bir xil holatni qayta so‘rash — takror (bir marta ishlanadi)
      eventId: `refresh:${row.shipmentId}:${status}`,
      type: 'shipment.status_changed',
      shipmentId: row.shipmentId,
      externalOrderId: elchiOrderRef(id),
      status: status as ElchiWebhookDto['status'],
      occurredAt: now.toISOString(),
    } as ElchiWebhookDto);
    const applied = outcome.result === 'APPLIED';
    return {
      orderId: id,
      elchiStatus: item.status,
      status: outcome.status ?? row.status,
      applied,
      detail: applied
        ? null
        : outcome.result === 'REJECTED'
          ? 'Holat faqat oldinga o‘tadi'
          : 'Holat o‘zgarmagan',
    };
  }

  async exportCount(
    filters: OrderExportFilterDto,
    until: Date,
  ): Promise<{ rows: number }> {
    return {
      rows: await this.orders.adminOrderCount(exportQuery(filters), until),
    };
  }

  /** CSV bo‘lagi: birinchi bo‘lakda sarlavha. Telefon — faqat oxirgi 4 raqam (134-savol). */
  async exportChunk(input: OrderExportChunkInput) {
    const columns = input.columns.filter((c) => c in CSV_HEADER);
    const rows = await this.orders.adminOrderChunk(
      exportQuery(input.filters),
      new Date(input.until),
      input.afterId,
      EXPORT_CHUNK,
    );
    const [geo, codes, subs] = await Promise.all([
      columns.includes(OrderExportColumn.CUSTOMER)
        ? this.geo(true)
        : new Map<string, string>(),
      columns.includes(OrderExportColumn.STREAM)
        ? this.streamCodes(rows.map((r) => r.streamId))
        : new Map<string, string>(),
      columns.includes(OrderExportColumn.SUBS)
        ? this.leadSubs(rows.map((r) => r.leadId))
        : new Map<string, string>(),
    ]);
    const cells: Record<OrderExportColumn, (r: AdminOrderRow) => string[]> = {
      [OrderExportColumn.ORDER]: (r) => [
        leadOrderNumber(r.id),
        r.leadId ?? '',
        dateTime(new Date(r.createdAt as string)),
      ],
      [OrderExportColumn.CUSTOMER]: (r) => [
        r.buyerName ?? '',
        this.regionName(geo, r.regionSoato) ?? '',
      ],
      [OrderExportColumn.PHONE]: (r) => [r.phoneMasked ?? ''],
      [OrderExportColumn.STREAM]: (r) => [
        r.streamId ? (codes.get(r.streamId) ?? '') : '',
      ],
      [OrderExportColumn.SOURCE]: (r) => [r.source ?? ''],
      [OrderExportColumn.AMOUNT]: (r) => [
        String(r.totalAmount),
        String(r.deliveryFee),
      ],
      [OrderExportColumn.STATUS]: (r) => [STATUS_LABELS[r.status] ?? r.status],
      [OrderExportColumn.TRACK]: (r) => [r.trackNumber ?? ''],
      [OrderExportColumn.PRICE_SNAPSHOT]: (r) =>
        r.priceSnapshot
          ? [
              r.priceSnapshot.basePrice,
              r.priceSnapshot.recommendedPrice,
              r.priceSnapshot.approvedPrice,
              r.priceSnapshot.markup,
              r.priceSnapshot.affiliateFee,
              r.priceSnapshot.callCenterFee,
              r.priceSnapshot.hiddenDelivery,
              r.priceSnapshot.platformService,
            ].map(String)
          : Array<string>(8).fill(''),
      [OrderExportColumn.SUBS]: (r) => [
        r.leadId ? (subs.get(r.leadId) ?? '') : '',
      ],
    };
    const line = (values: string[]) => values.map(csvCell).join(';');
    return {
      lines: [
        ...(input.afterId ? [] : [line(columns.flatMap((c) => CSV_HEADER[c]))]),
        ...rows.map((r) => line(columns.flatMap((c) => cells[c](r)))),
      ],
      nextAfterId:
        rows.length === EXPORT_CHUNK ? rows[rows.length - 1].id : null,
    };
  }

  // ------------------------------------------------------------------ yordamchi

  private scope(
    query: AdminOrderListQuery,
    viewer: OrderViewer,
  ): AdminOrderListQuery {
    if (viewer.kind === 'ADMIN') return query;
    if (viewer.kind === 'SUPERVISOR')
      return { ...query, leadOnly: true, shopId: undefined };
    if (!ID.test(viewer.userId))
      throw new ForbiddenException('Operator aniqlanmadi');
    // operator: sotuvchi, manba va boshqa operator filtrlari qo‘llanmaydi
    return {
      status: query.status,
      search: query.search,
      productId: query.productId,
      whereDeliver: query.whereDeliver,
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
      withCounts: query.withCounts,
      sort: query.sort,
      page: query.page,
      limit: query.limit,
      leadOnly: true,
      confirmedById: viewer.userId,
    };
  }

  private row(
    i: AdminOrderRow,
    viewer: OrderViewer,
    names: {
      nameOf: NameOf;
      geo: Map<string, string>;
      codes: Map<string, string>;
    },
    now: Date,
  ) {
    const operator = viewer.kind === 'OPERATOR';
    return {
      id: i.id,
      buyerName: i.buyerName,
      status: i.status,
      paymentMethod: i.paymentMethod,
      totalAmount: i.totalAmount,
      deliveryFee: i.deliveryFee,
      sellersCount: i.sellersCount,
      shipmentsCount: i.shipmentsCount,
      createdAt: i.createdAt,
      source: operator ? null : i.source,
      leadId: i.leadId,
      affiliateId: operator ? null : i.affiliateId,
      phoneMasked: i.phoneMasked,
      regionName: this.regionName(names.geo, i.regionSoato),
      districtName: this.districtName(
        names.geo,
        i.regionSoato,
        i.districtSoato,
      ),
      whereDeliver: i.whereDeliver,
      productId: i.productId,
      productName: i.productName,
      quantity: i.quantity,
      linesCount: i.linesCount,
      streamCode: i.streamId ? (names.codes.get(i.streamId) ?? null) : null,
      affiliateName:
        !operator && i.affiliateId ? names.nameOf(i.affiliateId) : null,
      statusAt: i.statusAt,
      statusDetail: this.detail(i, names.nameOf, now),
      trackNumber: i.trackNumber,
      elchiState: i.elchiState,
      confirmedBy: i.confirmedById
        ? {
            name: names.nameOf(i.confirmedById),
            at: new Date(i.createdAt as string).toISOString(),
          }
        : null,
    };
  }

  /** Holat ostidagi izoh: to‘lqin, yig‘uvchi, akt, bekor qilgan odam. */
  private detail(
    i: Pick<
      AdminOrderRow,
      'status' | 'pickDate' | 'pickedBy' | 'actId' | 'statusActorId'
    >,
    nameOf: NameOf,
    now: Date,
  ): string | null {
    switch (i.status) {
      case LeadOrderStatus.CONFIRMED:
        return waveText(i.pickDate, now);
      case LeadOrderStatus.PICKING:
        return i.pickedBy
          ? nameOf(i.pickedBy)
          : i.statusActorId
            ? nameOf(i.statusActorId)
            : null;
      case LeadOrderStatus.HANDED_TO_ELCHI:
        return i.actId ? `${actCode(i.actId)} aktida` : null;
      case LeadOrderStatus.CANCELLED:
        return i.statusActorId ? nameOf(i.statusActorId) : null;
      default:
        return null;
    }
  }

  private async namesOf(
    ids: Array<string | null | undefined>,
  ): Promise<NameOf> {
    return this.names ? this.names.resolve(ids) : (id) => `#${id}`;
  }

  /** Viloyat (`1726`) va tuman (`1726/1726266`) nomlari; geo javob bermasa — bo‘sh. */
  private async geo(needed: boolean): Promise<Map<string, string>> {
    const names = new Map<string, string>();
    if (!needed) return names;
    try {
      const tree = await firstValueFrom(
        this.integration
          .send<LeadRegionGroupDto[]>(
            { cmd: 'integration.geo.region-tree' },
            {},
          )
          .pipe(timeout(NAMES_TIMEOUT_MS)),
      );
      for (const region of Array.isArray(tree) ? tree : []) {
        names.set(region.satoCode, region.name);
        for (const district of region.districts)
          names.set(`${region.satoCode}/${district.satoCode}`, district.name);
      }
    } catch (error) {
      this.logger.warn(
        `Buyurtmalar: viloyat/tuman nomlari olinmadi — ${(error as Error).message}`,
      );
    }
    return names;
  }

  private regionName = (geo: Map<string, string>, soato: string | null) =>
    soato ? (geo.get(String(soato)) ?? null) : null;

  private districtName = (
    geo: Map<string, string>,
    region: string | null,
    district: string | null,
  ) => (region && district ? (geo.get(`${region}/${district}`) ?? null) : null);

  private streamCodes(ids: Array<string | null | undefined>) {
    return this.leadMap('lead.stream.codes', ids);
  }

  private leadSubs(ids: Array<string | null | undefined>) {
    return this.leadMap('lead.subs', ids);
  }

  /** lead-service dan id → matn; javob bo‘lmasa — bo‘sh. */
  private async leadMap(
    cmd: string,
    ids: Array<string | null | undefined>,
  ): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((id): id is string => !!id))];
    if (!unique.length) return new Map();
    try {
      const rows = await firstValueFrom(
        this.lead
          .send<Record<string, string>>({ cmd }, { ids: unique })
          .pipe(timeout(NAMES_TIMEOUT_MS)),
      );
      return new Map(Object.entries(rows ?? {}));
    } catch (error) {
      this.logger.warn(`Buyurtmalar: ${cmd} — ${(error as Error).message}`);
      return new Map();
    }
  }

  private async openDispute(orderId: string) {
    const row = await this.one<{
      at: Date;
      by: string;
      reason: string;
      keepUntil: Date;
    }>(
      `SELECT opened_at AS at, opened_by::text AS by, reason, keep_until AS "keepUntil"
         FROM checkout.order_dispute WHERE order_id = $1 AND closed_at IS NULL`,
      [orderId],
    );
    return row
      ? { ...row, at: new Date(row.at), keepUntil: new Date(row.keepUntil) }
      : null;
  }

  private async one<T>(sql: string, params: unknown[]): Promise<T | null> {
    const rows = (await this.dataSource.query(sql, params)) as T[];
    return rows[0] ?? null;
  }

  private async leadOrder(orderId: string): Promise<void> {
    if (!(await this.statuses.isLeadOrder(orderId)))
      throw new NotFoundException(`Buyurtma #${orderId} topilmadi`);
  }

  private id(value: unknown): string {
    const id = String(value ?? '');
    if (!ID.test(id)) throw new NotFoundException('Buyurtma topilmadi');
    return id;
  }

  private reason(value: unknown): string {
    const why = String(value ?? '').trim();
    if (!why)
      throw new BadRequestException({ message: ['reason sabab majburiy'] });
    return why;
  }
}

/** «14.01.2027 14:32» — Toshkent vaqti. */
function dateTime(at: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Tashkent',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const p = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((x) => x.type === type)!.value;
  return `${p('day')}.${p('month')}.${p('year')} ${two(Number(p('hour')))}:${p('minute')}`;
}
