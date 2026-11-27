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
import { Cron } from '@nestjs/schedule';
import PDFDocument from 'pdfkit';
import { firstValueFrom, timeout } from 'rxjs';
import { DataSource, EntityManager } from 'typeorm';
import {
  CATALOG_INVENTORY_PRODUCTS,
  CatalogInventoryProduct,
  InboundShipmentDto,
  InboundShipmentItemDto,
  InboundShipmentPageDto,
  InboundShipmentStatus,
  InventoryVariantCell,
  LOT_BLOCKED_EVENT,
  LOT_MIN_SHELF_DAYS,
  UserNamesClient,
  LotBlockedEvent,
  PDF_FONT,
  registerPdfFonts,
  RmqClient,
  runAsLeader,
  sendRpc,
  StockLotDto,
  StockMovementType,
  WarehouseOwnerType,
  WholesalerPageDto,
} from '@app/common';
import { Stock } from './entities/stock.entity';
import { blockedByVariant } from './stock-lots';
import {
  lockStock,
  recordInboundReceived,
  recordOfferOutOfStock,
  saveMovement,
} from './inventory.helpers';
import {
  dmy,
  keepTogether,
  minusDays,
  pageFooters,
  signedQty,
  staffName,
  tashkentDateTime,
  tashkentTime,
} from './pdf-text';
import { TODAY_SQL } from './stock-lots';

const ID = /^[1-9]\d{0,18}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const CELL = /^[A-Za-z0-9][A-Za-z0-9-]{0,31}$/;
const NOTIFY_TIMEOUT_MS = 5_000;
/** Qidiruvda optovik nomini katalogdan kutish — gateway kutishidan (10 s) ancha qisqa. */
const CATALOG_SEARCH_TIMEOUT_MS = 1_500;

export interface PdfFile {
  fileName: string;
  contentType: string;
  base64: string;
}

interface ShipmentRow {
  id: string;
  wholesalerId: string;
  status: InboundShipmentStatus;
  expectedAt: string;
  note: string | null;
  declaredBy: string;
  receivedBy: string | null;
  receivedAt: Date | null;
  receiveComment: string | null;
  createdAt: Date;
}

const SHIPMENT_SELECT = `SELECT s.id::text, s.wholesaler_id::text AS "wholesalerId", s.status,
  to_char(s.expected_at, 'YYYY-MM-DD') AS "expectedAt", s.note, s.declared_by::text AS "declaredBy",
  s.received_by::text AS "receivedBy", s.received_at AS "receivedAt", s.receive_comment AS "receiveComment",
  s.created_at AS "createdAt"
  FROM inventory.inbound_shipment s`;

const ITEM_SELECT = `SELECT id::text, shipment_id::text AS "shipmentId", product_id::text AS "productId",
  product_name AS "productName", variant_id::text AS "variantId", sku, barcode,
  declared_qty AS "declaredQty", received_qty AS "receivedQty", defective_qty AS "defectiveQty", batch,
  to_char(expiry_date, 'YYYY-MM-DD') AS "expiryDate", cell
  FROM inventory.inbound_shipment_item`;

/** Postavka va akt raqami: `PS-000014`. */
export function shipmentNumber(id: string): string {
  return `PS-${String(id).padStart(6, '0')}`;
}

/**
 * Ombor qabuli (BE-17; TZ 6.6 OMB-1, OMB-2, OMB-3; T4 `inbound_shipment`, `stock_lot`).
 *
 * Omborchi yoki admin optovik nomidan postavkani e’lon qiladi (optovik kabineti BE-30 da), omborchi qabul qiladi:
 * qabul qilingan va brak soni, partiya, yaroqlilik muddati, yacheyka. Qoldiqqa faqat yaroqli soni kiradi; muddat
 * kiritilsa — partiya (muddatga 60 kundan kam qolganda sotuvdan chiqadi). Farq yoki brak bo‘lsa — «Farq bor» va akt.
 */
@Injectable()
export class InboundService {
  private readonly logger = new Logger(InboundService.name);

  constructor(
    private readonly dataSource: DataSource,
    @Inject(RmqClient.CATALOG) private readonly catalog: ClientProxy,
    @Optional()
    @Inject(RmqClient.NOTIFICATION)
    private readonly notifications?: ClientProxy,
    @Optional() private readonly names?: UserNamesClient,
  ) {}

  /** OMB-1: e’lon (omborchi, admin, superadmin) — CPA mahsulotlarining yagona varianti, shu optovikniki. */
  async declare(input: {
    wholesalerId: string;
    expectedAt: string;
    note?: string;
    items: Array<{ productId: string; quantity: number }>;
    actorId: string;
  }): Promise<InboundShipmentDto> {
    const wholesalerId = this.id(input?.wholesalerId, 'Optovik');
    const actorId = this.id(input?.actorId, 'Foydalanuvchi');
    const expectedAt = String(input?.expectedAt ?? '');
    if (!this.validDay(expectedAt))
      throw new BadRequestException('expectedAt YYYY-MM-DD bo‘lishi kerak');
    const items = input?.items ?? [];
    if (!items.length)
      throw new BadRequestException('Kamida bitta mahsulot kerak');
    const productIds = items.map((item) =>
      this.id(item?.productId, 'Mahsulot'),
    );
    if (new Set(productIds).size !== productIds.length)
      throw new BadRequestException('Mahsulot takrorlangan');
    for (const item of items)
      if (!Number.isSafeInteger(item.quantity) || item.quantity < 1)
        throw new BadRequestException('Soni musbat butun son bo‘lishi kerak');
    const products = new Map(
      (
        await sendRpc<CatalogInventoryProduct[]>(
          this.catalog,
          { cmd: CATALOG_INVENTORY_PRODUCTS },
          { productIds },
        )
      ).map((product) => [String(product.productId), product]),
    );
    for (const productId of productIds) {
      const product = products.get(productId);
      if (!product)
        throw new BadRequestException(
          `Mahsulot ${productId} topilmadi yoki faol varianti yo‘q`,
        );
      if (String(product.wholesalerId) !== wholesalerId)
        throw new BadRequestException(
          `Mahsulot ${productId} boshqa optovikniki`,
        );
    }
    const id = await this.dataSource.transaction(async (manager) => {
      const [shipment] = (await manager.query(
        `INSERT INTO inventory.inbound_shipment (wholesaler_id, expected_at, note, declared_by)
         VALUES ($1, $2::date, $3, $4) RETURNING id::text`,
        [wholesalerId, expectedAt, input.note?.trim() || null, actorId],
      )) as Array<{ id: string }>;
      for (const item of items) {
        const product = products.get(String(item.productId))!;
        await manager.query(
          `INSERT INTO inventory.inbound_shipment_item
             (shipment_id, product_id, variant_id, product_name, sku, barcode, declared_qty)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            shipment.id,
            product.productId,
            product.variantId,
            product.productName,
            product.sku,
            product.barcode,
            item.quantity,
          ],
        );
      }
      return shipment.id;
    });
    return this.get({ id });
  }

  /**
   * Postavkalar (yangisi tepada). BE-25 (FE-16): bir nechta holat, qidiruv, kelish sanasi va qabul kuni (Toshkent);
   * `counts` — holatlar soni, `status` dan boshqa filtrlar bo‘yicha.
   */
  async list(query: {
    status?: InboundShipmentStatus | InboundShipmentStatus[];
    wholesalerId?: string;
    search?: string;
    expectedFrom?: string;
    expectedTo?: string;
    receivedOn?: string;
    page?: number;
    limit?: number;
  }): Promise<InboundShipmentPageDto> {
    const page = Math.max(1, Number(query?.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query?.limit) || 20));
    const where: string[] = ['TRUE'];
    const params: unknown[] = [];
    const param = (value: unknown) => `$${params.push(value)}`;
    if (query?.wholesalerId)
      where.push(
        `s.wholesaler_id = ${param(this.id(query.wholesalerId, 'Optovik'))}`,
      );
    if (query?.expectedFrom)
      where.push(
        `s.expected_at >= ${param(this.day(query.expectedFrom, 'expectedFrom'))}::date`,
      );
    if (query?.expectedTo)
      where.push(
        `s.expected_at <= ${param(this.day(query.expectedTo, 'expectedTo'))}::date`,
      );
    if (query?.receivedOn)
      where.push(
        `(s.received_at AT TIME ZONE 'Asia/Tashkent')::date = ${param(this.day(query.receivedOn, 'receivedOn'))}::date`,
      );
    const search = query?.search?.trim();
    if (search) where.push(await this.searchFilter(search, query, param));
    const counts = Object.fromEntries(
      Object.values(InboundShipmentStatus).map((status) => [status, 0]),
    ) as Record<InboundShipmentStatus, number>;
    for (const row of (await this.dataSource.query(
      `SELECT s.status, count(*)::int AS count
         FROM inventory.inbound_shipment s WHERE ${where.join(' AND ')} GROUP BY s.status`,
      params,
    )) as Array<{ status: InboundShipmentStatus; count: number }>)
      counts[row.status] = Number(row.count);
    const statuses = [query?.status ?? []].flat();
    if (statuses.length)
      where.push(`s.status = ANY(${param(statuses)}::text[])`);
    const total = (
      statuses.length
        ? [...new Set(statuses)]
        : Object.values(InboundShipmentStatus)
    ).reduce((sum, status) => sum + (counts[status] ?? 0), 0);
    const rows = (await this.dataSource.query(
      `${SHIPMENT_SELECT} WHERE ${where.join(' AND ')} ORDER BY s.id DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, (page - 1) * limit],
    )) as ShipmentRow[];
    const items = await this.itemsOf(
      this.dataSource.manager,
      rows.map((row) => row.id),
    );
    return {
      items: rows.map((row) => this.toDto(row, items.get(row.id) ?? [])),
      total,
      page,
      limit,
      counts,
    };
  }

  /** Raqam (`PS-000014`, `14`), mahsulot nomi, SKU, shtrix-kod yoki optovik nomi (katalog javob bermasa — nomsiz). */
  private async searchFilter(
    search: string,
    query: { wholesalerId?: string },
    param: (value: unknown) => string,
  ): Promise<string> {
    const like = param(`%${search.replace(/[\\%_]/g, '\\$&')}%`);
    const parts = [
      `EXISTS (SELECT 1 FROM inventory.inbound_shipment_item i
                WHERE i.shipment_id = s.id
                  AND (i.product_name ILIKE ${like} OR i.sku ILIKE ${like} OR i.barcode ILIKE ${like}))`,
    ];
    const number = /^(?:PS-?)?0*([1-9]\d{0,17})$/i.exec(search)?.[1];
    if (number) parts.push(`s.id = ${param(number)}::bigint`);
    // optovik kabinetida ro‘yxat o‘zi bitta optovikniki — nom bo‘yicha qidiruv kerak emas
    if (!query?.wholesalerId) {
      const found = await firstValueFrom(
        this.catalog
          .send<WholesalerPageDto>(
            { cmd: 'catalog.wholesaler.admin-list' },
            { search, page: 1, limit: 100 },
          )
          .pipe(timeout(CATALOG_SEARCH_TIMEOUT_MS)),
      ).catch((error: Error) => {
        this.logger.warn(`Optovik nomi bo‘yicha qidirilmadi: ${error.message}`);
        return null;
      });
      const ids = (found?.items ?? []).map((item) => String(item.id));
      if (ids.length)
        parts.push(`s.wholesaler_id = ANY(${param(ids)}::bigint[])`);
    }
    return `(${parts.join(' OR ')})`;
  }

  /** OMB-2 (BE-25, FE-17): SKU yacheykasi HQ omborda; yacheykasi yozilmagan variant — null. */
  async variantCells(variantIds: string[]): Promise<InventoryVariantCell[]> {
    const ids = [
      ...new Set((Array.isArray(variantIds) ? variantIds : []).map(String)),
    ].filter((id) => ID.test(id));
    if (!ids.length) return [];
    return (await this.dataSource.query(
      `SELECT s.variant_id::text AS "variantId", s.cell
         FROM inventory.stock s
         JOIN inventory.warehouse w ON w.id = s.warehouse_id
        WHERE s.variant_id = ANY($1::bigint[]) AND w.owner_type = $2 AND w.is_deleted = FALSE`,
      [ids, WarehouseOwnerType.HQ],
    )) as InventoryVariantCell[];
  }

  async get(input: { id: string }): Promise<InboundShipmentDto> {
    const id = this.id(input?.id, 'Postavka');
    const [row] = (await this.dataSource.query(
      `${SHIPMENT_SELECT} WHERE id = $1`,
      [id],
    )) as ShipmentRow[];
    if (!row) throw new NotFoundException('Postavka topilmadi');
    const items = await this.itemsOf(this.dataSource.manager, [id]);
    return this.toDto(row, items.get(id) ?? []);
  }

  /** «Yo‘lda» — ixtiyoriy [taklif: TZ da kim qo‘yishi yo‘q]; takror — o‘sha holat. */
  async inTransit(input: { id: string }): Promise<InboundShipmentDto> {
    const id = this.id(input?.id, 'Postavka');
    await this.dataSource.transaction(async (manager) => {
      const [row] = (await manager.query(
        'SELECT status FROM inventory.inbound_shipment WHERE id = $1 FOR UPDATE',
        [id],
      )) as Array<{ status: InboundShipmentStatus }>;
      if (!row) throw new NotFoundException('Postavka topilmadi');
      if (row.status === InboundShipmentStatus.IN_TRANSIT) return;
      if (row.status !== InboundShipmentStatus.DECLARED)
        throw new ConflictException(`Postavka holati ${row.status}`);
      await manager.query(
        `UPDATE inventory.inbound_shipment SET status = 'IN_TRANSIT', updated_at = now() WHERE id = $1`,
        [id],
      );
    });
    return this.get({ id });
  }

  /**
   * OMB-1, OMB-3 (TC1, TC2): qabul — har qator uchun qabul qilingan va brak soni, partiya, muddat, yacheyka.
   * Qoldiqqa yaroqli soni (qabul − brak) kiradi; muddat kiritilsa — partiya. Farq yoki brak — DISCREPANCY.
   * Qabul qilingan postavka qayta yuborilsa — o‘sha natija (o‘zgarmaydi).
   */
  async receive(input: {
    id: string;
    items: Array<{
      itemId: string;
      receivedQty: number;
      defectiveQty: number;
      batch?: string;
      expiryDate?: string;
      cell: string;
    }>;
    comment?: string;
    actorId: string;
  }): Promise<InboundShipmentDto> {
    const id = this.id(input?.id, 'Postavka');
    const actorId = this.id(input?.actorId, 'Foydalanuvchi');
    const lines = input?.items ?? [];
    const blockedLots: string[] = [];
    await this.dataSource.transaction(async (manager) => {
      const [shipment] = (await manager.query(
        `${SHIPMENT_SELECT} WHERE id = $1 FOR UPDATE`,
        [id],
      )) as ShipmentRow[];
      if (!shipment) throw new NotFoundException('Postavka topilmadi');
      if (
        shipment.status === InboundShipmentStatus.RECEIVED ||
        shipment.status === InboundShipmentStatus.DISCREPANCY
      )
        return; // takroriy yuborish — o‘sha natija
      const items = (await this.itemsOf(manager, [id])).get(id) ?? [];
      const byId = new Map(items.map((item) => [item.id, item]));
      const seen = new Set<string>();
      for (const line of lines) {
        const itemId = String(line?.itemId ?? '');
        if (!byId.has(itemId) || seen.has(itemId))
          throw new BadRequestException(`Postavka qatori noto‘g‘ri: ${itemId}`);
        seen.add(itemId);
        if (
          !Number.isSafeInteger(line.receivedQty) ||
          line.receivedQty < 0 ||
          !Number.isSafeInteger(line.defectiveQty) ||
          line.defectiveQty < 0 ||
          line.defectiveQty > line.receivedQty
        )
          throw new BadRequestException(
            'Qabul va brak soni: butun, 0 dan katta, brak ≤ qabul',
          );
        if (!CELL.test(String(line.cell ?? '')))
          throw new BadRequestException(
            'Yacheyka manzili kerak (masalan B-02-1)',
          );
        if (line.expiryDate !== undefined && !this.validDay(line.expiryDate))
          throw new BadRequestException('expiryDate YYYY-MM-DD bo‘lishi kerak');
      }
      if (seen.size !== items.length)
        throw new BadRequestException(
          'Postavkaning hamma qatori qabul qilinishi kerak',
        );
      const warehouseId = await this.hqWarehouseId(manager);
      let discrepancy = false;
      // qulf tartibi band qilish bilan bir xil (variant bo‘yicha) — parallel qabulda deadlock bo‘lmasin
      const ordered = [...lines].sort(
        (a, b) =>
          Number(byId.get(String(a.itemId))!.variantId) -
          Number(byId.get(String(b.itemId))!.variantId),
      );
      for (const line of ordered) {
        const item = byId.get(String(line.itemId))!;
        const good = line.receivedQty - line.defectiveQty;
        if (line.receivedQty !== item.declaredQty || line.defectiveQty > 0)
          discrepancy = true;
        await manager.query(
          `UPDATE inventory.inbound_shipment_item
              SET received_qty = $2, defective_qty = $3, batch = $4, expiry_date = $5::date, cell = $6
            WHERE id = $1`,
          [
            item.id,
            line.receivedQty,
            line.defectiveQty,
            line.batch?.trim() || null,
            line.expiryDate ?? null,
            line.cell,
          ],
        );
        let stock = await lockStock(manager, item.variantId, warehouseId);
        const stocks = manager.getRepository(Stock);
        if (!stock)
          stock = await stocks.save(
            stocks.create({
              variantId: item.variantId,
              warehouseId,
              quantityOnHand: 0,
              quantityReserved: 0,
              lowStockThreshold: 0,
            }),
          );
        stock.cell = line.cell; // OMB-2: SKU yacheykasi
        stock.quantityOnHand += good;
        stock = await stocks.save(stock);
        if (good > 0) {
          await saveMovement(
            manager,
            stock,
            StockMovementType.INBOUND,
            good,
            `Postavka ${shipmentNumber(id)}`,
            actorId,
            'INBOUND_SHIPMENT',
            id,
          );
          if (line.expiryDate) {
            const [lot] = (await manager.query(
              `INSERT INTO inventory.stock_lot
                 (variant_id, warehouse_id, shipment_item_id, batch, expiry_date, sellable_until, quantity)
               VALUES ($1, $2, $3, $4, $5::date, $5::date - $6::int, $7)
               RETURNING id::text, sellable_until < ${TODAY_SQL} AS blocked`,
              [
                item.variantId,
                warehouseId,
                item.id,
                line.batch?.trim() || null,
                line.expiryDate,
                LOT_MIN_SHELF_DAYS,
                good,
              ],
            )) as Array<{ id: string; blocked: boolean }>;
            if (lot.blocked) blockedLots.push(lot.id); // qabuldayoq 60 kundan kam (TC2) — darhol xabar
          }
        }
      }
      await manager.query(
        `UPDATE inventory.inbound_shipment
            SET status = $2, received_by = $3, received_at = now(), receive_comment = $4, updated_at = now()
          WHERE id = $1`,
        [
          id,
          discrepancy
            ? InboundShipmentStatus.DISCREPANCY
            : InboundShipmentStatus.RECEIVED,
          actorId,
          input.comment?.trim() || null,
        ],
      );
      // BE-47: optovikka «Postavka qabul qilindi, brak topildi» — shu tranzaksiyada outbox’ga (yo‘qolmaydi)
      await recordInboundReceived(manager, {
        shipmentId: id,
        number: shipmentNumber(id),
        wholesalerId: String(shipment.wholesalerId),
        status: discrepancy
          ? InboundShipmentStatus.DISCREPANCY
          : InboundShipmentStatus.RECEIVED,
        declaredQty: items.reduce(
          (sum, item) => sum + Number(item.declaredQty),
          0,
        ),
        receivedQty: lines.reduce((sum, line) => sum + line.receivedQty, 0),
        defectiveQty: lines.reduce((sum, line) => sum + line.defectiveQty, 0),
      });
    });
    if (blockedLots.length) await this.notifyBlocked(blockedLots);
    return this.get({ id });
  }

  /** OMB-3: partiyalar — muddat, sotuvdan chiqish sanasi, holat (admin «Muddat» ro‘yxati). */
  async lots(query: {
    state?: 'BLOCKED' | 'SELLABLE' | 'ALL';
  }): Promise<StockLotDto[]> {
    const state = query?.state ?? 'ALL';
    const filter =
      state === 'BLOCKED'
        ? `AND l.sellable_until < ${TODAY_SQL}`
        : state === 'SELLABLE'
          ? `AND l.sellable_until >= ${TODAY_SQL}`
          : '';
    const rows = (await this.dataSource.query(
      `SELECT l.id::text, l.variant_id::text AS "variantId", i.sku, i.product_name AS "productName", l.batch,
              to_char(l.expiry_date, 'YYYY-MM-DD') AS "expiryDate",
              to_char(l.sellable_until, 'YYYY-MM-DD') AS "sellableUntil", l.quantity,
              l.sellable_until < ${TODAY_SQL} AS blocked,
              s.wholesaler_id::text AS "wholesalerId", l.notified_at AS "notifiedAt"
         FROM inventory.stock_lot l
         JOIN inventory.inbound_shipment_item i ON i.id = l.shipment_item_id
         JOIN inventory.inbound_shipment s ON s.id = i.shipment_id
        WHERE l.quantity > 0 ${filter}
        ORDER BY l.sellable_until, l.id
        LIMIT 500`,
    )) as StockLotDto[];
    return rows.map((row) => ({ ...row, quantity: Number(row.quantity) }));
  }

  /** Har kuni 08:00 (Toshkent) [taklif]: sotuvdan chiqqan, hali xabar berilmagan partiyalar — admin va superadminga. */
  @Cron('0 0 8 * * *', {
    name: 'inventory-lot-blocked',
    timeZone: 'Asia/Tashkent',
  })
  async dailyBlocked(): Promise<void> {
    await runAsLeader(this.dataSource, 'inventory-lot-blocked', async () => {
      const rows = (await this.dataSource.query(
        `SELECT id::text FROM inventory.stock_lot
          WHERE quantity > 0 AND notified_at IS NULL AND sellable_until < ${TODAY_SQL}`,
      )) as Array<{ id: string }>;
      // BE-47: kunlik ishda (partiya endi muddatdan chiqdi) — «qoldiq tugadi» ham tekshiriladi
      if (rows.length)
        await this.notifyBlocked(
          rows.map((row) => row.id),
          true,
        );
    });
  }

  /**
   * Xabar ketgach `notified_at`; yuborilmasa — keyingi kun qayta. `checkStock` — kunlik ish: partiya muddatdan chiqib
   * sotuvga yaroqli qoldiq kamaydi (qabuldayoq muddati o‘tgan partiya qoldiqni kamaytirmaydi — tekshirilmaydi).
   */
  async notifyBlocked(lotIds: string[], checkStock = false): Promise<void> {
    if (!this.notifications || !lotIds.length) return;
    // avval band qilinadi (qabul va kunlik tekshiruv bir vaqtda ikki xabar yubormasin); yuborilmasa — bo‘shatiladi
    const claimed = this.rows<{ id: string }>(
      await this.dataSource.query(
        `UPDATE inventory.stock_lot SET notified_at = now()
          WHERE id = ANY($1::bigint[]) AND notified_at IS NULL RETURNING id::text`,
        [lotIds],
      ),
    ).map((row) => row.id);
    if (!claimed.length) return;
    const lots = (await this.dataSource.query(
      `SELECT l.id::text AS "lotId", i.sku, i.product_name AS "productName", l.batch,
              to_char(l.expiry_date, 'YYYY-MM-DD') AS "expiryDate",
              to_char(l.sellable_until, 'YYYY-MM-DD') AS "sellableUntil", l.quantity
         FROM inventory.stock_lot l
         JOIN inventory.inbound_shipment_item i ON i.id = l.shipment_item_id
        WHERE l.id = ANY($1::bigint[])`,
      [claimed],
    )) as LotBlockedEvent['lots'];
    const event: LotBlockedEvent = {
      lots: lots.map((lot) => ({ ...lot, quantity: Number(lot.quantity) })),
    };
    try {
      await firstValueFrom(
        this.notifications
          .emit(LOT_BLOCKED_EVENT, event)
          .pipe(timeout(NOTIFY_TIMEOUT_MS)),
        { defaultValue: undefined },
      );
    } catch (error) {
      this.logger.warn(
        `Partiya muddati xabari yuborilmadi: ${(error as Error)?.message}`,
      );
      await this.dataSource.query(
        `UPDATE inventory.stock_lot SET notified_at = NULL WHERE id = ANY($1::bigint[])`,
        [claimed],
      );
      return; // ertaga qayta — «qoldiq tugadi» ham o‘shanda (ikki marta yozilmasin)
    }
    if (checkStock) await this.recordStockOut(claimed);
  }

  /** BE-47: muddatdan chiqqan partiya sotuvga yaroqli qoldiqni kamaytiradi — 0 bo‘lsa «Offer qoldig‘i tugadi». */
  private async recordStockOut(lotIds: string[]): Promise<void> {
    const variants = (await this.dataSource.query(
      `SELECT DISTINCT variant_id::text AS "variantId", warehouse_id::text AS "warehouseId"
         FROM inventory.stock_lot WHERE id = ANY($1::bigint[])`,
      [lotIds],
    )) as Array<{ variantId: string; warehouseId: string }>;
    for (const warehouseId of new Set(variants.map((v) => v.warehouseId)))
      await recordOfferOutOfStock(
        this.dataSource.manager,
        variants
          .filter((v) => v.warehouseId === warehouseId)
          .map((v) => v.variantId),
        warehouseId,
        blockedByVariant,
      );
  }

  /** TypeORM UPDATE … RETURNING uchun [qatorlar, soni] qaytaradi. */
  private rows<T>(result: unknown): T[] {
    const list = result as unknown[];
    return (Array.isArray(list?.[0]) ? list[0] : list) as T[];
  }

  /**
   * Postavka qabul akti PDF (dizayn `hujjat-qabul-akti`, docs/dizayn/manbalar/h-1.md 3.1): komitent — optovik (nom,
   * STIR, shartnoma — katalog), qatorlar — mahsulot, SKU/shtrix-kod, yacheyka, partiya, muddat, e’lon/qabul/brak/farq.
   * «Qabul» — yaroqlisi (kelgan − brak), «Farq» — qabul − e’lon: ekran (FE-16 `InboundActPage`) va dizayn bilan bir xil
   * (TC1: 100 keldi, 2 brak → qabul 98, farq −2). Xodim — ism bilan («Jasur T., omborchi»), identity javob bermasa `#ID`.
   */
  async actPdf(input: { id: string }): Promise<PdfFile> {
    const shipment = await this.get(input);
    if (
      shipment.status !== InboundShipmentStatus.RECEIVED &&
      shipment.status !== InboundShipmentStatus.DISCREPANCY
    )
      throw new ConflictException('Akt qabuldan keyin tuziladi');
    const [wholesaler, receiver] = await Promise.all([
      sendRpc<{
        name: string;
        tin: string | null;
        contractNumber: string | null;
        contractDate: string | null;
      }>(
        this.catalog,
        { cmd: 'catalog.wholesaler.admin-get' },
        { id: shipment.wholesalerId },
      ).catch(() => null),
      staffName(this.names, shipment.receivedBy),
    ]);
    const doc = registerPdfFonts(
      new PDFDocument({
        size: 'A4',
        margin: 40,
        compress: false,
        bufferPages: true,
        info: { Title: `Postavka qabul akti ${shipment.number}` },
      }),
    );
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    const completed = new Promise<Buffer>((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });
    const receivedAt = shipment.receivedAt
      ? tashkentDateTime(shipment.receivedAt)
      : '—';
    const receivedDay = shipment.receivedAt
      ? tashkentTime(shipment.receivedAt).slice(0, 10)
      : null;
    const discrepancy = shipment.status === InboundShipmentStatus.DISCREPANCY;

    doc
      .font(PDF_FONT.bold)
      .fontSize(14)
      .text(`Postavka qabul akti No ${shipment.number}`);
    doc
      .font(PDF_FONT.regular)
      .fontSize(10)
      .text(discrepancy ? 'FARQ BOR · farq akti' : 'FARQSIZ')
      .moveDown(0.5)
      .text(
        `Komitent (optovik): ${wholesaler?.name ?? `#${shipment.wholesalerId}`}, STIR ${wholesaler?.tin ?? '—'}`,
      )
      .text('Komissioner (platforma): Elchi Marketplace')
      .text(
        `Asos: komissiya shartnomasi № ${wholesaler?.contractNumber?.trim() || '—'}${
          wholesaler?.contractDate ? `, ${dmy(wholesaler.contractDate)}` : ''
        }`,
      )
      .text(
        `Postavka arizasi: ${shipment.number} · Kelish sanasi: ${dmy(shipment.expectedAt) ?? '—'}`,
      )
      .text(`Qabul yakunlandi: ${receivedAt} · Qabul qildi: ${receiver.label}`)
      .moveDown();
    doc
      .font(PDF_FONT.bold)
      .fontSize(8)
      .text(
        'No  Mahsulot | SKU / shtrix-kod | Yacheyka | Partiya | Muddat | E’lon | Qabul | Brak | Farq',
      );
    doc.font(PDF_FONT.regular).fontSize(8);
    let declared = 0;
    let arrived = 0;
    let accepted = 0;
    let defective = 0;
    let blocked = 0;
    // kam va ortiq — har qator bo‘yicha (bir mahsulot ortiq, boshqasi kam kelsa jamida yo‘qolib ketmasin)
    let shortage = 0;
    let surplus = 0;
    shipment.items.forEach((item, index) => {
      const got = item.receivedQty ?? 0;
      const bad = item.defectiveQty ?? 0;
      const good = Math.max(0, got - bad);
      declared += item.declaredQty;
      arrived += got;
      accepted += good;
      defective += bad;
      shortage += Math.max(0, item.declaredQty - got);
      surplus += Math.max(0, got - item.declaredQty);
      // qabul kuni muddatiga 60 kundan kam qolgan partiya sotuvga chiqmaydi (OMB-3, qabuldagi qoida bilan bir xil)
      const lotBlocked =
        !!item.expiryDate &&
        !!receivedDay &&
        minusDays(item.expiryDate, LOT_MIN_SHELF_DAYS) < receivedDay;
      if (lotBlocked) blocked += good;
      const expiry = item.expiryDate
        ? `${dmy(item.expiryDate)}${lotBlocked ? ' · sotuvga chiqmaydi' : ''}`
        : 'kuzatilmaydi';
      // partiya kiritilmagan bo‘lsa — postavka raqami (ekran va dizayn h-1 §3.2 bilan bir xil)
      doc.text(
        `${index + 1}.  ${item.productName} | ${item.sku}${item.barcode ? ` / ${item.barcode}` : ''} | ${item.cell ?? '—'} | ${item.batch ?? shipment.number} | ${expiry} | ${item.declaredQty} | ${good} | ${bad} | ${signedQty(good - item.declaredQty)}`,
      );
    });
    doc
      .moveDown()
      .font(PDF_FONT.bold)
      .text(
        `Jami: e’lon ${declared}, qabul ${accepted}, brak ${defective}, farq ${signedQty(accepted - declared)}`,
      )
      .font(PDF_FONT.regular)
      .text('Skaner bilan sanaldi')
      .moveDown();
    // xulosa (dizayn h-1.md 3.1, ekran `InboundActPage` matni); xulosa va imzolar bitta betda
    keepTogether(doc, 190);
    doc.fontSize(10);
    if (!discrepancy && !defective && !shortage && !surplus)
      doc
        .text(`Farq yo‘q: ${accepted} / ${declared} dona`)
        .text('Brak yo‘q · kam kelgan tovar yo‘q');
    else {
      const diff = accepted - declared;
      const parts =
        defective > 0 && !shortage && !surplus
          ? 'hammasi brak'
          : [
              defective ? `${defective} brak` : '',
              shortage ? `${shortage} kam kelgan` : '',
              surplus ? `${surplus} ortiq` : '',
            ]
              .filter(Boolean)
              .join(', ') || '—';
      doc
        .text(`Farq: ${signedQty(diff)} dona — ${parts}`)
        .text(
          `Sanaldi: ${arrived} / ${declared} · ${
            [
              shortage ? `kam kelgan ${shortage}` : '',
              surplus ? `ortiq ${surplus}` : '',
            ]
              .filter(Boolean)
              .join(', ') || 'kam kelgan tovar yo‘q'
          }`,
        );
    }
    doc.text(
      blocked
        ? `Qoldiqqa kirdi: ${accepted} dona — shundan ${blocked} dona sotuvga chiqmaydi (muddatiga ${LOT_MIN_SHELF_DAYS} kundan kam).`
        : `Qoldiqqa kirdi: ${accepted} dona — sotuvga chiqdi.`,
    );
    if (defective)
      doc.text(
        `Brak: ${defective} dona — qoldiqqa kirmaydi. Brak tovar uchun pul yozilmaydi.`,
      );
    if (shipment.receiveComment)
      doc.moveDown().text(`Ombor izohi: ${shipment.receiveComment}`);
    doc
      .moveDown(2)
      .text(
        `Qabul qildi — ombor: ${receiver.label}   ________________   Muhr o‘rni`,
      )
      .moveDown()
      .text(
        'Topshirdi — optovik vakili (F.I.Sh.): ________________   Muhr o‘rni',
      );
    pageFooters(doc, (page, count) => [
      `Postavka qabul akti ${shipment.number} · ${page} / ${count} bet`,
      `Tuzildi ${receivedAt} · ${receiver.short}`,
    ]);
    doc.end();
    const pdf = await completed;
    return {
      fileName: `qabul-akti_${shipment.number}.pdf`,
      contentType: 'application/pdf',
      base64: pdf.toString('base64'),
    };
  }

  private async itemsOf(
    manager: EntityManager,
    shipmentIds: string[],
  ): Promise<
    Map<string, Array<InboundShipmentItemDto & { shipmentId: string }>>
  > {
    const result = new Map<
      string,
      Array<InboundShipmentItemDto & { shipmentId: string }>
    >();
    if (!shipmentIds.length) return result;
    const rows = (await manager.query(
      `${ITEM_SELECT} WHERE shipment_id = ANY($1::bigint[]) ORDER BY id`,
      [shipmentIds],
    )) as Array<InboundShipmentItemDto & { shipmentId: string }>;
    for (const row of rows) {
      const list = result.get(row.shipmentId) ?? [];
      list.push({
        ...row,
        declaredQty: Number(row.declaredQty),
        receivedQty: row.receivedQty === null ? null : Number(row.receivedQty),
        defectiveQty:
          row.defectiveQty === null ? null : Number(row.defectiveQty),
      });
      result.set(row.shipmentId, list);
    }
    return result;
  }

  private async hqWarehouseId(manager: EntityManager): Promise<string> {
    const [hq] = (await manager.query(
      `SELECT id::text FROM inventory.warehouse
        WHERE owner_type = $1 AND is_deleted = FALSE AND is_active = TRUE LIMIT 1`,
      [WarehouseOwnerType.HQ],
    )) as Array<{ id: string }>;
    if (!hq) throw new ConflictException('HQ ombor topilmadi');
    return hq.id;
  }

  private toDto(
    row: ShipmentRow,
    items: Array<InboundShipmentItemDto & { shipmentId?: string }>,
  ): InboundShipmentDto {
    return {
      id: row.id,
      number: shipmentNumber(row.id),
      wholesalerId: row.wholesalerId,
      status: row.status,
      expectedAt: row.expectedAt,
      note: row.note,
      declaredBy: row.declaredBy,
      receivedBy: row.receivedBy,
      receivedAt: row.receivedAt,
      receiveComment: row.receiveComment,
      items: items.map((item) => {
        const copy = { ...item };
        delete copy.shipmentId;
        return copy;
      }),
      createdAt: row.createdAt,
    };
  }

  private id(value: unknown, label: string): string {
    const id = String(value ?? '');
    if (!ID.test(id)) throw new BadRequestException(`${label} ID si noto‘g‘ri`);
    return id;
  }

  private day(value: string, field: string): string {
    if (!this.validDay(String(value)))
      throw new BadRequestException(`${field} YYYY-MM-DD bo‘lishi kerak`);
    return String(value);
  }

  private validDay(value: string): boolean {
    if (!DAY.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00Z`);
    return (
      !Number.isNaN(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === value
    );
  }
}
