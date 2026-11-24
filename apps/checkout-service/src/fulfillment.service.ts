import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom, timeout } from 'rxjs';
import { DataSource, EntityManager } from 'typeorm';
import {
  CheckoutDeliveryDestination,
  ErrorCode,
  FulfillmentTaskStatus,
  HandoverActsPage,
  HandoverActView,
  INVENTORY_VARIANT_CELLS,
  InventoryVariantCell,
  LeadOrderActor,
  LeadOrderActorType,
  LeadOrderStatus,
  LeadRegionGroupDto,
  ParcelElchiState,
  PickListItem,
  PickListLine,
  PickListPage,
  RmqClient,
  tashkentDate,
} from '@app/common';
import {
  AppliedTransition,
  LeadOrderStatusService,
  leadOrderNumber,
  TransitionRejected,
} from './lead-order-status.service';
import {
  ShippingLabelData,
  ShippingLabelDocument,
  ShippingLabelService,
} from './shipping-label.service';

const ID = /^[1-9]\d{0,18}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** «2026-02-30» kabi mavjud bo‘lmagan sana ham rad (Date.parse uni keyingi oyga suradi). */
const isRealDate = (day: string) =>
  DATE.test(day) &&
  !Number.isNaN(Date.parse(`${day}T00:00:00Z`)) &&
  new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) === day;
/** Bitta aktda posilkalar [taklif]: bitta tranzaksiya va javob gateway kutishiga sig‘sin. */
const MAX_ACT_PARCELS = 200;
/** Yorliqdagi viloyat/tuman nomi uchun kutish — gateway kutishidan ancha qisqa. */
const GEO_TIMEOUT_MS = 3_000;
/** Yacheykalarni ombordan kutish: javob bo‘lmasa ro‘yxat yacheykasiz qaytadi [taklif]. */
const CELLS_TIMEOUT_MS = 1_500;
/** Bir kunlik ro‘yxat chegarasi (sahifalashsiz); oshsa — `truncated`. */
const PICK_LIST_LIMIT = 1_000;
/** Yorliqdagi jo‘natuvchi — bitta platforma marketi (BE-20 `ELCHI_PLATFORM_MARKET_ID`) [taklif]. */
const SENDER_NAME = 'Elchi Market';

/** Topshirish akti sarlavhasi: vaqt — Toshkent, «YYYY-MM-DD HH:MI». */
const ACT_COLUMNS = `id::text AS id, parcel_count AS "parcelCount", created_by::text AS "createdBy",
  to_char(created_at AT TIME ZONE 'Asia/Tashkent', 'YYYY-MM-DD HH24:MI') AS "createdAt"`;

interface ActRow {
  id: string;
  parcelCount: number;
  createdBy: string;
  createdAt: string;
}

interface TaskRow {
  id: string;
  orderId: string;
  parcelId: string;
  status: FulfillmentTaskStatus;
  requiredQty: number;
  pickedQty: number;
  sku: string | null;
  barcode: string | null;
  orderStatus: LeadOrderStatus;
}

/** Yig‘ish ro‘yxatining tovar qatori (SQL `json_agg`). */
interface PickLineRow {
  variantId: string | null;
  productName: string | null;
  sku: string | null;
  barcode: string | null;
  quantity: number;
  pickedQty: number;
  weightGrams: number | null;
}

const deliveryModeOf = (value: unknown): 'CENTER' | 'DOOR' | null =>
  value === CheckoutDeliveryDestination.CENTER
    ? 'CENTER'
    : value === CheckoutDeliveryDestination.ADDRESS
      ? 'DOOR'
      : null;

const isoOrNull = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  const at = new Date(value as string | Date);
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
};

export interface WarehouseActor {
  id: string;
  role?: string | null;
}

/**
 * Ombor (BE-19; TZ 6.6 OMB-2, OMB-4, OMB-5): kunlik yig‘ish ro‘yxati, skaner, qadoq, yorliq va Elchi’ga topshirish
 * akti. Buyurtma holati vazifa bilan BITTA tranzaksiyada o‘zgaradi (`LeadOrderStatusService.applyTransition`):
 * birinchi to‘g‘ri skaner — «Yig‘ilmoqda», qadoq — «Qadoqlandi», akt — «Elchi’ga topshirildi» (band chiqimga
 * aylanadi, BE-16/BE-18).
 */
@Injectable()
export class FulfillmentService {
  private readonly logger = new Logger(FulfillmentService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly status: LeadOrderStatusService,
    private readonly labels: ShippingLabelService,
    @Inject(RmqClient.INTEGRATION) private readonly integration: ClientProxy,
    @Optional()
    @Inject(RmqClient.INVENTORY)
    private readonly inventory?: ClientProxy,
  ) {}

  /**
   * Kunlik yig‘ish ro‘yxati (OMB-4): tanlangan kun va undan oldingi, hali topshirilmagan vazifalar (kechikkan
   * belgisi bilan). Kun berilmasa — bugun (Toshkent).
   */
  async pickList(date?: string): Promise<PickListPage> {
    const day = date ?? tashkentDate(new Date());
    if (!isRealDate(day))
      throw new BadRequestException('date YYYY-MM-DD bo‘lishi kerak');
    const rows = (await this.dataSource.query(
      `SELECT t.id::text AS "taskId", t.order_id::text AS "orderId", t.status,
              to_char(t.pick_date, 'YYYY-MM-DD') AS "pickDate",
              t.required_qty AS "requiredQty", t.picked_qty AS "pickedQty",
              i.product_name AS "productName", i.sku, i.barcode,
              p.elchi_state AS "elchiState", p.elchi_shipment_id::text AS "shipmentId",
              (p.elchi_shipment_id IS NOT NULL AND p.qr_code_token IS NOT NULL) AS "labelReady",
              p.elchi_error AS "elchiError", p.qr_code_token AS "qrCodeToken",
              t.packed_at AS "packedAt", o.buyer_name AS "customerName",
              o.region_soato AS "regionSoato", o.district_soato AS "districtSoato",
              o.where_deliver AS "whereDeliver",
              COALESCE(p.elchi_to_be_paid, o.cod_amount)::text AS "codAmount",
              COALESCE((SELECT r.payload->>'confirmedAt' FROM checkout.lead_order_request r
                         WHERE r.order_id = o.id LIMIT 1),
                       to_char(o.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) AS "confirmedAt",
              (SELECT json_agg(json_build_object(
                        'variantId', x.variant_id::text,
                        'productName', x.product_name, 'sku', x.sku, 'barcode', x.barcode,
                        'quantity', x.quantity, 'pickedQty', x.picked_qty,
                        'weightGrams', x.weight_grams) ORDER BY x.id)
                 FROM checkout.sales_order_item x WHERE x.sales_order_seller_id = p.id) AS lines
         FROM checkout.fulfillment_task t
         JOIN checkout.parcel p ON p.id = t.parcel_id
         JOIN checkout.sales_order o ON o.id = t.order_id
         JOIN LATERAL (
           SELECT product_name, sku, barcode FROM checkout.sales_order_item
            WHERE sales_order_seller_id = p.id ORDER BY id LIMIT 1
         ) i ON TRUE
        WHERE t.pick_date <= $1::date
          AND t.status IN ('TO_PICK', 'PICKED', 'PACKED')
        ORDER BY t.pick_date, t.id
        LIMIT $2`,
      [day, PICK_LIST_LIMIT + 1],
    )) as Array<Record<string, unknown>>;
    const truncated = rows.length > PICK_LIST_LIMIT;
    const page = rows.slice(0, PICK_LIST_LIMIT);
    const linesOf = (r: Record<string, unknown>) =>
      (r.lines as PickLineRow[] | null) ?? [];
    const [geo, cells] = page.length
      ? await Promise.all([
          this.geoTree(),
          this.cellsOf(
            page.flatMap((r) => linesOf(r).map((line) => line.variantId)),
          ),
        ])
      : [new Map<string, string>(), new Map<string, string | null>()];
    const items: PickListItem[] = page.map((r) => ({
      taskId: String(r.taskId),
      orderId: String(r.orderId),
      orderNumber: leadOrderNumber(String(r.orderId)),
      status: r.status as FulfillmentTaskStatus,
      pickDate: String(r.pickDate),
      overdue: String(r.pickDate) < day,
      productName: String(r.productName ?? ''),
      sku: (r.sku as string) ?? null,
      barcode: (r.barcode as string) ?? null,
      quantity: Number(r.requiredQty),
      pickedQty: Number(r.pickedQty),
      lines: linesOf(r).map((line): PickListLine => ({
        productName: String(line.productName ?? ''),
        sku: line.sku ?? null,
        barcode: line.barcode ?? null,
        quantity: Number(line.quantity),
        pickedQty: Number(line.pickedQty),
        cell: line.variantId ? (cells.get(line.variantId) ?? null) : null,
        weightKg:
          line.weightGrams == null ? null : Number(line.weightGrams) / 1_000,
      })),
      customerName: (r.customerName as string) || null,
      regionName: geo.get(String(r.regionSoato)) ?? null,
      districtName:
        geo.get(`${String(r.regionSoato)}/${String(r.districtSoato)}`) ?? null,
      deliveryMode: deliveryModeOf(r.whereDeliver),
      codAmount: r.codAmount == null ? null : Number(r.codAmount),
      confirmedAt: isoOrNull(r.confirmedAt),
      packedAt: isoOrNull(r.packedAt),
      parcel: {
        elchiState: (r.elchiState as ParcelElchiState) ?? null,
        shipmentId: (r.shipmentId as string) ?? null,
        labelReady: Boolean(r.labelReady),
        error: (r.elchiError as string) ?? null,
        qrCodeToken: (r.qrCodeToken as string) ?? null,
      },
    }));
    const count = (status: FulfillmentTaskStatus) =>
      items.filter((item) => item.status === status).length;
    return {
      date: day,
      items,
      counts: {
        toPick: count(FulfillmentTaskStatus.TO_PICK),
        picked: count(FulfillmentTaskStatus.PICKED),
        packed: count(FulfillmentTaskStatus.PACKED),
        overdue: items.filter((item) => item.overdue).length,
      },
      truncated,
    };
  }

  /**
   * Skaner (OMB-2, TC2): kod buyurtmadagi tovarning shtrix-kodi yoki SKU siga mos bo‘lishi kerak, aks holda 409
   * (`WRONG_ITEM`) va jurnalda. Birinchi to‘g‘ri skaner — buyurtma «Yig‘ilmoqda»; hamma dona — vazifa «Yig‘ildi».
   */
  async scan(taskId: string, code: string, actor: WarehouseActor) {
    const scanned = String(code ?? '').trim();
    if (!scanned || scanned.length > 100)
      throw new BadRequestException('Kod bo‘sh yoki juda uzun');
    const who = this.actorOf(actor);
    const outcome: { wrong?: string } = {};
    const result = await this.inTransaction(async (manager) => {
      const task = await this.lockTask(manager, taskId);
      if (task.status !== FulfillmentTaskStatus.TO_PICK)
        throw this.taskState(task, 'skanerlash');
      // OMB-2: shtrix-kod bo‘lsa — faqat u; bo‘lmasa SKU. Aniq solishtirish (katalogda SKU katta-kichik harfga sezgir)
      // bo‘sh shtrix-kod ('' yoki bo‘shliq) — yo‘q hisoblanadi, SKU ishlaydi. BE-34: posilkada bir nechta tovar
      // bo‘lishi mumkin — kod mos kelgan, hali to‘liq yig‘ilmagan qator sanaladi
      const codeOf = `COALESCE(NULLIF(btrim(barcode), ''), NULLIF(btrim(sku), ''))`;
      const [line] = (await manager.query(
        `SELECT id::text AS id FROM checkout.sales_order_item
          WHERE sales_order_seller_id = $1 AND picked_qty < quantity AND ${codeOf} = $2
          ORDER BY id LIMIT 1
          FOR UPDATE`,
        [task.parcelId, scanned],
      )) as Array<{ id: string }>;
      await manager.query(
        `INSERT INTO checkout.fulfillment_scan (task_id, code, matched, actor_id)
         VALUES ($1, $2, $3, $4)`,
        [task.id, scanned, !!line, who.id],
      );
      if (!line) {
        const [known] = (await manager.query(
          `SELECT 1 FROM checkout.sales_order_item
            WHERE sales_order_seller_id = $1 AND ${codeOf} = $2 LIMIT 1`,
          [task.parcelId, scanned],
        )) as unknown[];
        // kutilgan kod aytilmaydi — qo‘lda terib o‘tkazib yuborilmasin
        outcome.wrong = known
          ? `«${scanned}» — bu tovardan hamma dona yig‘ilgan`
          : `Boshqa tovar: «${scanned}» bu buyurtmaga tegishli emas`;
        return null;
      }
      await manager.query(
        `UPDATE checkout.sales_order_item SET picked_qty = picked_qty + 1 WHERE id = $1`,
        [line.id],
      );
      let applied: AppliedTransition | null = null;
      if (task.orderStatus === LeadOrderStatus.CONFIRMED)
        applied = await this.status.applyTransition(manager, {
          orderId: task.orderId,
          to: LeadOrderStatus.PICKING,
          actor: who,
          reason: null,
        });
      const picked = task.pickedQty + 1;
      const done = picked === task.requiredQty;
      await manager.query(
        `UPDATE checkout.fulfillment_task
            SET picked_qty = $2, status = $3,
                picked_at = CASE WHEN $4 THEN now() ELSE picked_at END,
                picked_by = CASE WHEN $4 THEN $5::bigint ELSE picked_by END,
                updated_at = now()
          WHERE id = $1`,
        [
          task.id,
          picked,
          done ? FulfillmentTaskStatus.PICKED : FulfillmentTaskStatus.TO_PICK,
          done,
          who.id,
        ],
      );
      return {
        applied,
        view: {
          taskId: task.id,
          orderId: task.orderId,
          status: done
            ? FulfillmentTaskStatus.PICKED
            : FulfillmentTaskStatus.TO_PICK,
          pickedQty: picked,
          quantity: task.requiredQty,
        },
      };
    }, who);
    // Noto‘g‘ri tovar: skaner jurnali saqlangan (tranzaksiya commit bo‘ldi), keyingi qadam yopiq
    if (outcome.wrong)
      throw new ConflictException({
        message: outcome.wrong,
        errorCode: ErrorCode.WRONG_ITEM,
      });
    await this.status.sendInventoryNow(result!.applied?.command ?? null);
    return result!.view;
  }

  /** Qadoqlash: faqat hamma dona to‘g‘ri skanerlangandan keyin; buyurtma «Qadoqlandi». */
  async pack(taskId: string, actor: WarehouseActor) {
    const who = this.actorOf(actor);
    const result = await this.inTransaction(async (manager) => {
      const task = await this.lockTask(manager, taskId);
      if (task.status !== FulfillmentTaskStatus.PICKED)
        throw this.taskState(task, 'qadoqlash');
      const applied = await this.status.applyTransition(manager, {
        orderId: task.orderId,
        to: LeadOrderStatus.PACKED,
        actor: who,
        reason: null,
      });
      await manager.query(
        `UPDATE checkout.fulfillment_task
            SET status = 'PACKED', packed_at = now(), packed_by = $2, updated_at = now()
          WHERE id = $1`,
        [task.id, who.id],
      );
      return {
        applied,
        view: {
          taskId: task.id,
          orderId: task.orderId,
          status: FulfillmentTaskStatus.PACKED,
        },
      };
    }, who);
    await this.status.sendInventoryNow(result.applied.command);
    return result.view;
  }

  /**
   * Yorliq ma’lumoti (OMB-4, TC3): Elchi posilka raqami va QR token, mijoz — operator tasdiqlagan manzil (viloyat va
   * tuman nomi SOATO dan), telefon, COD. Elchi posilkasi hali yo‘q bo‘lsa — 409.
   */
  async labelData(orderId: string): Promise<ShippingLabelData> {
    if (!ID.test(String(orderId ?? '')))
      throw new NotFoundException('Buyurtma topilmadi');
    const [row] = (await this.dataSource.query(
      `SELECT o.id::text AS "orderId", o.buyer_name AS "buyerName",
              o.customer_phone AS phone, o.region_soato AS "regionSoato",
              o.district_soato AS "districtSoato", o.delivery_address AS address,
              o.cod_amount::text AS "codAmount", p.id::text AS "parcelId",
              p.elchi_shipment_id::text AS "shipmentId", p.qr_code_token AS "qrToken",
              p.elchi_to_be_paid::text AS "toBePaid", p.elchi_state AS "elchiState",
              p.elchi_error AS "elchiError", o.status AS "orderStatus"
         FROM checkout.sales_order o
         JOIN checkout.parcel p ON p.sales_order_id = o.id
        WHERE o.id = $1 AND o.source IS NOT NULL
        ORDER BY p.id LIMIT 1`,
      [String(orderId)],
    )) as Array<Record<string, string | null>>;
    if (!row) throw new NotFoundException('Buyurtma topilmadi');
    if (
      row.orderStatus === LeadOrderStatus.CANCELLED ||
      row.elchiState === ParcelElchiState.CANCELLED
    )
      throw new ConflictException({
        message: 'Buyurtma bekor qilingan — yorliq chiqmaydi',
        errorCode: ErrorCode.INVALID_STATE,
      });
    if (!row.shipmentId || !row.qrToken)
      throw new ConflictException({
        message:
          row.elchiState === ParcelElchiState.FAILED
            ? `Elchi posilkasi yaratilmadi: ${row.elchiError ?? 'sabab noma’lum'}`
            : 'Elchi posilkasi hali yaratilmagan — yorliqni keyinroq chop eting',
        errorCode: ErrorCode.INVALID_STATE,
      });
    const items = (await this.dataSource.query(
      `SELECT product_name AS "productName", quantity
         FROM checkout.sales_order_item WHERE sales_order_seller_id = $1 ORDER BY id`,
      [row.parcelId],
    )) as Array<{ productName: string; quantity: number }>;
    const geo = await this.geoNames(
      String(row.regionSoato),
      String(row.districtSoato),
    );
    return {
      sellerOrderId: String(row.parcelId),
      salesOrderId: String(row.orderId),
      shipmentId: String(row.shipmentId),
      qrCodeToken: String(row.qrToken),
      senderName: SENDER_NAME,
      buyerName: String(row.buyerName ?? ''),
      buyerPhone: String(row.phone ?? ''),
      regionName: geo.regionName,
      districtName: geo.districtName,
      deliveryAddress: String(row.address ?? ''),
      codAmount: Number(row.toBePaid ?? row.codAmount ?? 0),
      items: items.map((item) => ({
        productName: item.productName,
        quantity: Number(item.quantity),
      })),
    };
  }

  async label(orderId: string): Promise<ShippingLabelDocument> {
    return this.labels.generate(await this.labelData(orderId));
  }

  /** Berilgan ID lardan lid buyurtmalari (admin yorliq partiyasi shu bo‘yicha ajratiladi). */
  async leadOrderIds(orderIds: string[]): Promise<string[]> {
    const ids = (Array.isArray(orderIds) ? orderIds : [])
      .map(String)
      .filter((id) => ID.test(id));
    if (!ids.length) return [];
    const rows = (await this.dataSource.query(
      `SELECT id::text AS id FROM checkout.sales_order
        WHERE id = ANY($1::bigint[]) AND source IS NOT NULL`,
      [ids],
    )) as Array<{ id: string }>;
    return rows.map((row) => row.id);
  }

  /** Lid buyurtmalari yorliqlari partiyada: chiqmaganlari sababi bilan (butun partiya yiqilmaydi). */
  async collectLabels(orderIds: string[]): Promise<{
    labels: ShippingLabelData[];
    skipped: Array<{ orderId: string; reason: string }>;
  }> {
    const labels: ShippingLabelData[] = [];
    const skipped: Array<{ orderId: string; reason: string }> = [];
    // parallel: Elchi geo javob bermasa ham partiya bitta kutish (3 s) bilan tugaydi
    const results = await Promise.allSettled(
      orderIds.map((orderId) => this.labelData(orderId)),
    );
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        labels.push(result.value);
        return;
      }
      const error = result.reason as Error;
      const response =
        error instanceof ConflictException || error instanceof NotFoundException
          ? (error.getResponse() as { message?: string } | string)
          : null;
      skipped.push({
        orderId: orderIds[index],
        reason:
          typeof response === 'object' && response?.message
            ? String(response.message)
            : error.message,
      });
    });
    return { labels, skipped };
  }

  /**
   * Elchi’ga topshirish akti (OMB-5, TC4): skanerlangan QR lar bo‘yicha. Har posilka «Qadoqlandi» va Elchi posilkasi
   * yaratilgan bo‘lishi kerak — bittasi ham tayyor bo‘lmasa butun akt rad (qaysi va nima uchun). Bitta tranzaksiyada:
   * har buyurtma «Elchi’ga topshirildi» (band chiqimga), vazifa «Topshirildi», akt va qatorlari — aktdagi son =
   * topshirilgan posilkalar.
   */
  async handover(qrTokens: string[], actor: WarehouseActor) {
    const who = this.actorOf(actor);
    const tokens = [
      ...new Set(
        (Array.isArray(qrTokens) ? qrTokens : [])
          .map((token) => String(token ?? '').trim())
          .filter(Boolean),
      ),
    ];
    if (!tokens.length || tokens.length > MAX_ACT_PARCELS)
      throw new BadRequestException(`1 dan ${MAX_ACT_PARCELS} gacha QR kerak`);
    const result = await this.inTransaction(async (manager) => {
      // Qulf tartibi hamma joyda bir xil: avval buyurtma, keyin vazifa (bekor qilish bilan o‘zaro to‘siq bo‘lmasin)
      await manager.query(
        `SELECT o.id FROM checkout.sales_order o
           JOIN checkout.parcel p ON p.sales_order_id = o.id
          WHERE p.qr_code_token = ANY($1::text[])
          ORDER BY o.id
          FOR UPDATE OF o`,
        [tokens],
      );
      const rows = (await manager.query(
        `SELECT p.id::text AS "parcelId", p.qr_code_token AS "qrToken",
                p.elchi_shipment_id::text AS "shipmentId", p.sales_order_id::text AS "orderId",
                p.handover_act_id::text AS "actId",
                t.id::text AS "taskId", t.status, o.status AS "orderStatus"
           FROM checkout.parcel p
           JOIN checkout.fulfillment_task t ON t.parcel_id = p.id
           JOIN checkout.sales_order o ON o.id = p.sales_order_id
          WHERE p.qr_code_token = ANY($1::text[])
          ORDER BY p.id
          FOR UPDATE OF t`,
        [tokens],
      )) as Array<{
        parcelId: string;
        qrToken: string;
        shipmentId: string | null;
        orderId: string;
        actId: string | null;
        taskId: string;
        status: FulfillmentTaskStatus;
        orderStatus: LeadOrderStatus;
      }>;
      // Takror so‘rov (javob yo‘qolgan): hammasi bitta aktda topshirilgan — o‘sha akt qaytadi
      const acts = new Set(rows.map((r) => r.actId));
      if (
        rows.length === tokens.length &&
        acts.size === 1 &&
        rows[0].actId &&
        rows.every((r) => r.status === FulfillmentTaskStatus.HANDED_OVER)
      ) {
        const [act] = (await manager.query(
          `SELECT parcel_count AS count FROM checkout.handover_act WHERE id = $1`,
          [rows[0].actId],
        )) as Array<{ count: number }>;
        // aynan o‘sha posilkalar to‘plami bo‘lsa — o‘sha akt (qismi emas)
        if (Number(act?.count) === tokens.length)
          return { actId: rows[0].actId, applied: [] as AppliedTransition[] };
      }
      const found = new Set(rows.map((r) => r.qrToken));
      const problems = [
        ...tokens
          .filter((token) => !found.has(token))
          .map((token) => `${token}: posilka topilmadi`),
        ...rows
          .filter((r) => r.status !== FulfillmentTaskStatus.PACKED)
          .map(
            (r) => `${leadOrderNumber(r.orderId)}: qadoqlanmagan (${r.status})`,
          ),
        ...rows
          .filter(
            (r) =>
              r.status === FulfillmentTaskStatus.PACKED &&
              r.orderStatus !== LeadOrderStatus.PACKED,
          )
          .map(
            (r) =>
              `${leadOrderNumber(r.orderId)}: buyurtma holati ${r.orderStatus}`,
          ),
        ...rows
          .filter((r) => !r.shipmentId)
          .map((r) => `${leadOrderNumber(r.orderId)}: Elchi posilkasi yo‘q`),
      ];
      if (problems.length)
        throw new ConflictException({
          message: `Akt tuzilmadi: ${problems.join('; ')}`,
          errorCode: ErrorCode.INVALID_STATE,
        });
      const [act] = (await manager.query(
        `INSERT INTO checkout.handover_act (parcel_count, created_by)
         VALUES ($1, $2) RETURNING id::text AS id`,
        [rows.length, who.id],
      )) as Array<{ id: string }>;
      const applied: AppliedTransition[] = [];
      for (const row of rows) {
        applied.push(
          await this.status.applyTransition(manager, {
            orderId: row.orderId,
            to: LeadOrderStatus.HANDED_TO_ELCHI,
            actor: who,
            reason: `Topshirish akti ${act.id}`,
          }),
        );
        await manager.query(
          `UPDATE checkout.fulfillment_task
              SET status = 'HANDED_OVER', handed_over_at = now(), handed_over_by = $2,
                  updated_at = now()
            WHERE id = $1`,
          [row.taskId, who.id],
        );
        await manager.query(
          `UPDATE checkout.parcel
              SET handed_over_at = now(), handover_act_id = $2, updated_at = now()
            WHERE id = $1`,
          [row.parcelId, act.id],
        );
        await manager.query(
          `INSERT INTO checkout.handover_act_item
             (act_id, parcel_id, order_id, shipment_id, qr_code_token)
           VALUES ($1, $2, $3, $4, $5)`,
          [act.id, row.parcelId, row.orderId, row.shipmentId, row.qrToken],
        );
      }
      return { actId: act.id, applied };
    }, who);
    // Ombor buyruqlari outbox’da — relay yetkazadi; javobni kutmaymiz (ko‘p posilkada gateway kutishi tugab qolardi)
    for (const applied of result.applied)
      void this.status.sendInventoryNow(applied.command);
    return this.act(result.actId);
  }

  async act(id: string): Promise<HandoverActView> {
    if (!ID.test(String(id ?? '')))
      throw new NotFoundException('Akt topilmadi');
    const [act] = (await this.dataSource.query(
      `SELECT ${ACT_COLUMNS} FROM checkout.handover_act WHERE id = $1`,
      [String(id)],
    )) as ActRow[];
    if (!act) throw new NotFoundException('Akt topilmadi');
    const [view] = await this.withItems([act]);
    return view;
  }

  /**
   * BE-25 (FE-17 «Oldingi aktlar»): topshirish aktlari, yangisi tepada; har akt — `act()` bilan bir xil shakl.
   * Sahifa chegarasi DTO da ham (gateway), bu yerda ham — RPC to‘g‘ridan chaqirilsa.
   */
  async acts(input?: {
    page?: number;
    limit?: number;
  }): Promise<HandoverActsPage> {
    const page = Math.min(
      100_000,
      Math.max(1, Math.trunc(Number(input?.page) || 1)),
    );
    const limit = Math.min(
      100,
      Math.max(1, Math.trunc(Number(input?.limit) || 20)),
    );
    const [{ total }] = (await this.dataSource.query(
      `SELECT COUNT(*)::int AS total FROM checkout.handover_act`,
    )) as Array<{ total: number }>;
    const rows = (await this.dataSource.query(
      `SELECT ${ACT_COLUMNS} FROM checkout.handover_act
        ORDER BY created_at DESC, id DESC LIMIT $1 OFFSET $2`,
      [limit, (page - 1) * limit],
    )) as ActRow[];
    return {
      items: await this.withItems(rows),
      total: Number(total),
      page,
      limit,
    };
  }

  private async withItems(acts: ActRow[]): Promise<HandoverActView[]> {
    if (!acts.length) return [];
    const items = (await this.dataSource.query(
      `SELECT act_id::text AS "actId", parcel_id::text AS "parcelId", order_id::text AS "orderId",
              shipment_id::text AS "shipmentId", qr_code_token AS "qrCodeToken"
         FROM checkout.handover_act_item WHERE act_id = ANY($1::bigint[]) ORDER BY act_id, id`,
      [acts.map((act) => act.id)],
    )) as Array<{
      actId: string;
      parcelId: string;
      orderId: string;
      shipmentId: string;
      qrCodeToken: string;
    }>;
    return acts.map((act) => ({
      id: act.id,
      parcelCount: Number(act.parcelCount),
      createdBy: act.createdBy,
      createdAt: act.createdAt,
      items: items
        .filter((item) => item.actId === act.id)
        .map((item) => ({
          parcelId: item.parcelId,
          orderId: item.orderId,
          shipmentId: item.shipmentId,
          qrCodeToken: item.qrCodeToken,
          orderNumber: leadOrderNumber(item.orderId),
        })),
    }));
  }

  async actPdf(id: string): Promise<ShippingLabelDocument> {
    const act = await this.act(id);
    return this.labels.generateHandoverAct({
      id: act.id,
      createdAt: act.createdAt,
      items: act.items,
    });
  }

  /** Tranzaksiya; ruxsatsiz holat o‘tishi (`TransitionRejected`) — qaytgandan keyin jurnalga (BUY-2). */
  private async inTransaction<T>(
    work: (manager: EntityManager) => Promise<T>,
    actor: LeadOrderActor,
  ): Promise<T> {
    try {
      return await this.dataSource.transaction(work);
    } catch (error) {
      if (error instanceof TransitionRejected)
        await this.status.recordRejected(error, actor, null);
      throw error;
    }
  }

  private async lockTask(
    manager: EntityManager,
    taskId: string,
  ): Promise<TaskRow> {
    if (!ID.test(String(taskId ?? '')))
      throw new NotFoundException('Vazifa topilmadi');
    // Qulf tartibi: avval buyurtma, keyin vazifa (bekor qilish ham shu tartibda)
    await manager.query(
      `SELECT o.id FROM checkout.sales_order o
         JOIN checkout.fulfillment_task t ON t.order_id = o.id
        WHERE t.id = $1
        FOR UPDATE OF o`,
      [String(taskId)],
    );
    const [task] = (await manager.query(
      `SELECT t.id::text AS id, t.order_id::text AS "orderId", t.parcel_id::text AS "parcelId", t.status,
              t.required_qty AS "requiredQty", t.picked_qty AS "pickedQty",
              i.sku, i.barcode, o.status AS "orderStatus"
         FROM checkout.fulfillment_task t
         JOIN checkout.sales_order o ON o.id = t.order_id
         JOIN LATERAL (
           SELECT sku, barcode FROM checkout.sales_order_item
            WHERE sales_order_seller_id = t.parcel_id ORDER BY id LIMIT 1
         ) i ON TRUE
        WHERE t.id = $1
        FOR UPDATE OF t`,
      [String(taskId)],
    )) as TaskRow[];
    if (!task) throw new NotFoundException('Vazifa topilmadi');
    return {
      ...task,
      requiredQty: Number(task.requiredQty),
      pickedQty: Number(task.pickedQty),
    };
  }

  private taskState(task: TaskRow, action: string): ConflictException {
    const reason =
      task.status === FulfillmentTaskStatus.PICKED && action === 'skanerlash'
        ? 'hamma dona yig‘ilgan'
        : task.status === FulfillmentTaskStatus.TO_PICK
          ? `hali ${task.pickedQty}/${task.requiredQty} dona yig‘ilgan`
          : `vazifa holati ${task.status}`;
    return new ConflictException({
      message: `${action[0].toUpperCase()}${action.slice(1)} mumkin emas: ${reason}`,
      errorCode: ErrorCode.INVALID_STATE,
    });
  }

  /** Viloyat (`1726`) va tuman (`1726/1726262`) nomlari; geo keshi javob bermasa — bo‘sh (ro‘yxat nomsiz qaytadi). */
  private async geoTree(): Promise<Map<string, string>> {
    const names = new Map<string, string>();
    try {
      const tree = await firstValueFrom(
        this.integration
          .send<LeadRegionGroupDto[]>(
            { cmd: 'integration.geo.region-tree' },
            {},
          )
          .pipe(timeout(GEO_TIMEOUT_MS)),
      );
      for (const region of tree ?? []) {
        names.set(region.satoCode, region.name);
        for (const district of region.districts)
          names.set(`${region.satoCode}/${district.satoCode}`, district.name);
      }
    } catch (error) {
      this.logger.warn(
        `Yig‘ish ro‘yxati: viloyat/tuman nomlari olinmadi — ${(error as Error).message}`,
      );
    }
    return names;
  }

  /** OMB-2: yacheykalar (inventory); javob bo‘lmasa — bo‘sh. */
  private async cellsOf(
    variantIds: Array<string | null>,
  ): Promise<Map<string, string | null>> {
    const ids = [...new Set(variantIds.filter((id): id is string => !!id))];
    if (!this.inventory || !ids.length) return new Map();
    try {
      const rows = await firstValueFrom(
        this.inventory
          .send<InventoryVariantCell[]>(
            { cmd: INVENTORY_VARIANT_CELLS },
            { variantIds: ids },
          )
          .pipe(timeout(CELLS_TIMEOUT_MS)),
      );
      return new Map((rows ?? []).map((row) => [row.variantId, row.cell]));
    } catch (error) {
      this.logger.warn(
        `Yig‘ish ro‘yxati: yacheykalar olinmadi — ${(error as Error).message}`,
      );
      return new Map();
    }
  }

  /** Viloyat va tuman nomi (Elchi geo, BE-38/BE-20); javob bo‘lmasa — SOATO kodi (yorliq baribir chiqadi). */
  private async geoNames(
    regionSoato: string,
    districtSoato: string,
  ): Promise<{ regionName: string; districtName: string }> {
    try {
      const geo = await firstValueFrom(
        this.integration
          .send<{ ok: boolean; regionName?: string; districtName?: string }>(
            { cmd: 'integration.geo.resolve-address' },
            { regionSoato, districtSoato },
          )
          .pipe(timeout(GEO_TIMEOUT_MS)),
      );
      if (geo?.ok && geo.regionName && geo.districtName)
        return { regionName: geo.regionName, districtName: geo.districtName };
    } catch (error) {
      this.logger.warn(
        `Yorliq: viloyat/tuman nomi olinmadi (${regionSoato}/${districtSoato}): ${(error as Error).message}`,
      );
    }
    return {
      regionName: `SOATO ${regionSoato}`,
      districtName: `SOATO ${districtSoato}`,
    };
  }

  private actorOf(actor: WarehouseActor): LeadOrderActor {
    const id = String(actor?.id ?? '');
    if (!ID.test(id)) throw new BadRequestException('Omborchi ID si noto‘g‘ri');
    return {
      type: LeadOrderActorType.USER,
      id,
      role: actor?.role ? String(actor.role).slice(0, 20) : null,
    };
  }
}
