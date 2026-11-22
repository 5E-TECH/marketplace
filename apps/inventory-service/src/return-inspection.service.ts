import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import PDFDocument from 'pdfkit';
import { DataSource } from 'typeorm';
import {
  ReservationStatus,
  ReturnInspectionDto,
  RmqClient,
  sendRpc,
  StockMovementType,
} from '@app/common';
import { ReservationItem } from './entities/reservation-item.entity';
import { Reservation } from './entities/reservation.entity';
import { Stock } from './entities/stock.entity';
import { lockStock, saveMovement } from './inventory.helpers';
import { PdfFile } from './inbound.service';
import { tashkentTime, uzbekText } from './pdf-text';

const ID = /^[1-9]\d{0,18}$/;

interface InspectionRow {
  orderRef: string;
  parcelId: string | null;
  variantId: string;
  sellable: number;
  defective: number;
  comment: string | null;
  inspectedBy: string;
  inspectedAt: Date;
}

/**
 * Qaytgan tovarni saralash (BE-17; TZ OMB-6, T4 `return_inspection`, T5 «RETURNING → RETURNED_GRADED — omborchi»).
 *
 * Lid buyurtmasining band qilingan (chiqim bo‘lgan) tovarlari bo‘yicha: sotiladigan — qoldiqqa qaytadi (RETURN),
 * brak — DEFECT harakati, qoldiqqa kirmaydi (optovikka akt bilan qaytariladi). Posilkadagi hamma dona saralanadi
 * [taklif]. Bir buyurtma bir marta saralanadi; takror — o‘sha natija.
 */
@Injectable()
export class ReturnInspectionService {
  constructor(
    private readonly dataSource: DataSource,
    @Inject(RmqClient.CATALOG) private readonly catalog: ClientProxy,
  ) {}

  async grade(input: {
    orderRef: string;
    parcelId?: string | null;
    items: Array<{ variantId: string; sellable: number; defective: number }>;
    comment?: string;
    actorId: string;
  }): Promise<ReturnInspectionDto> {
    const orderRef = this.id(input?.orderRef, 'Buyurtma');
    const actorId = this.id(input?.actorId, 'Foydalanuvchi');
    const parcelId =
      input?.parcelId === undefined || input?.parcelId === null
        ? null
        : this.id(input.parcelId, 'Posilka');
    const requested = input?.items ?? [];
    for (const item of requested) {
      this.id(item?.variantId, 'Variant');
      if (
        !Number.isSafeInteger(item.sellable) ||
        !Number.isSafeInteger(item.defective) ||
        item.sellable < 0 ||
        item.defective < 0
      )
        throw new BadRequestException(
          'Soni butun va 0 dan katta bo‘lishi kerak',
        );
    }
    await this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `inventory-return-grade:${orderRef}`,
      ]);
      const existing = (await manager.query(
        'SELECT 1 FROM inventory.return_inspection WHERE order_ref = $1 LIMIT 1',
        [orderRef],
      )) as unknown[];
      if (existing.length) return; // allaqachon saralangan — o‘sha natija
      const reservation = await manager.getRepository(Reservation).findOne({
        where: { orderRef, status: ReservationStatus.COMMITTED },
      });
      if (!reservation)
        throw new ConflictException(
          'Buyurtma omborda chiqim qilinmagan — saralanadigan tovar yo‘q',
        );
      const allocations = await manager.getRepository(ReservationItem).find({
        where: { reservationId: reservation.id },
        order: { id: 'ASC' },
      });
      const committed = new Map<string, number>();
      for (const allocation of allocations)
        committed.set(
          String(allocation.variantId),
          (committed.get(String(allocation.variantId)) ?? 0) +
            allocation.quantity,
        );
      const byVariant = new Map(
        requested.map((item) => [String(item.variantId), item]),
      );
      if (
        byVariant.size !== requested.length ||
        byVariant.size !== committed.size ||
        [...committed].some(
          ([variantId, quantity]) =>
            !byVariant.has(variantId) ||
            byVariant.get(variantId)!.sellable +
              byVariant.get(variantId)!.defective !==
              quantity,
        )
      )
        throw new BadRequestException(
          `Posilkadagi hamma tovar saralanishi kerak: ${[...committed]
            .map(
              ([variantId, quantity]) =>
                `variant ${variantId} — ${quantity} dona`,
            )
            .join(', ')}`,
        );
      for (const allocation of allocations) {
        const item = byVariant.get(String(allocation.variantId))!;
        const stock = await lockStock(
          manager,
          allocation.variantId,
          allocation.warehouseId,
        );
        if (!stock) throw new ConflictException('Qoldiq yozuvi topilmadi');
        if (item.sellable > 0) {
          stock.quantityOnHand += item.sellable;
          await manager.getRepository(Stock).save(stock);
          await saveMovement(
            manager,
            stock,
            StockMovementType.RETURN,
            item.sellable,
            'Qaytgan tovar — sotiladigan',
            actorId,
            'RETURN_INSPECTION',
            orderRef,
          );
        }
        if (item.defective > 0)
          // brak qoldiqqa kirmaydi — harakat faqat qayd (optovikka akt bilan qaytariladi)
          await saveMovement(
            manager,
            stock,
            StockMovementType.DEFECT,
            item.defective,
            'Qaytgan tovar — brak (optovikka qaytariladi)',
            actorId,
            'RETURN_INSPECTION',
            orderRef,
          );
        await manager.query(
          `INSERT INTO inventory.return_inspection
             (order_ref, parcel_id, variant_id, sellable_qty, defective_qty, comment, inspected_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (order_ref, variant_id) DO NOTHING`,
          [
            orderRef,
            parcelId,
            allocation.variantId,
            item.sellable,
            item.defective,
            input.comment?.trim() || null,
            actorId,
          ],
        );
      }
    });
    return this.get({ orderRef });
  }

  async get(input: { orderRef: string }): Promise<ReturnInspectionDto> {
    const orderRef = this.id(input?.orderRef, 'Buyurtma');
    const rows = (await this.dataSource.query(
      `SELECT order_ref::text AS "orderRef", parcel_id::text AS "parcelId", variant_id::text AS "variantId",
              sellable_qty AS sellable, defective_qty AS defective, comment,
              inspected_by::text AS "inspectedBy", inspected_at AS "inspectedAt"
         FROM inventory.return_inspection WHERE order_ref = $1 ORDER BY id`,
      [orderRef],
    )) as InspectionRow[];
    if (!rows.length) throw new NotFoundException('Saralash topilmadi');
    return {
      orderId: orderRef,
      parcelId: rows[0].parcelId,
      items: rows.map((row) => ({
        variantId: row.variantId,
        sellable: Number(row.sellable),
        defective: Number(row.defective),
      })),
      comment: rows[0].comment,
      inspectedBy: rows[0].inspectedBy,
      inspectedAt: rows[0].inspectedAt,
    };
  }

  /** Brak akti PDF — har posilka uchun [taklif] (dizayn `hujjat-brak-akti`). Brak bo‘lmasa — 409. */
  async defectActPdf(input: {
    orderRef: string;
    shipmentId?: string | null;
  }): Promise<PdfFile> {
    const inspection = await this.get({ orderRef: input?.orderRef });
    const defective = inspection.items.filter((item) => item.defective > 0);
    if (!defective.length)
      throw new ConflictException('Bu posilkada brak yo‘q');
    const details = await sendRpc<
      Array<{ variantId: string; productName: string; sku: string }>
    >(
      this.catalog,
      { cmd: 'inventory.variant-details' },
      { variantIds: defective.map((item) => item.variantId) },
    ).catch(() => []);
    const names = new Map<string, { productName: string; sku: string }>(
      details.map((d) => [String(d.variantId), d] as const),
    );
    const doc = new PDFDocument({
      size: 'A4',
      margin: 40,
      compress: false,
      info: { Title: `Brak akti ${inspection.orderId}` },
    });
    uzbekText(doc);
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    const completed = new Promise<Buffer>((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });
    doc
      .font('Helvetica-Bold')
      .fontSize(14)
      .text(`Brak akti — buyurtma ${inspection.orderId}`);
    doc
      .font('Helvetica')
      .fontSize(10)
      .text(`Elchi posilkasi: ${input?.shipmentId ?? '—'}`)
      .text(
        `Saralandi: ${tashkentTime(inspection.inspectedAt)}, saraladi #${inspection.inspectedBy}`,
      )
      .moveDown();
    doc
      .font('Helvetica-Bold')
      .fontSize(9)
      .text('No  Mahsulot | SKU | Soni | Baho');
    doc.font('Helvetica').fontSize(9);
    defective.forEach((item, index) => {
      const detail = names.get(item.variantId);
      doc.text(
        `${index + 1}.  ${detail?.productName ?? `variant ${item.variantId}`} | ${detail?.sku ?? '—'} | ${item.defective} | Brak`,
      );
    });
    if (inspection.comment) doc.moveDown().text(`Izoh: ${inspection.comment}`);
    doc
      .moveDown(2)
      .text('Ombor: ____________________')
      .moveDown()
      .text('Optovik vakili: ____________________');
    doc.end();
    const pdf = await completed;
    return {
      fileName: `brak-akti_${inspection.orderId}.pdf`,
      contentType: 'application/pdf',
      base64: pdf.toString('base64'),
    };
  }

  private id(value: unknown, label: string): string {
    const id = String(value ?? '');
    if (!ID.test(id)) throw new BadRequestException(`${label} ID si noto‘g‘ri`);
    return id;
  }
}
