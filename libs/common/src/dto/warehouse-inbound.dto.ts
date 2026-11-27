import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Role } from '../enums';

/**
 * Ombor qabuli va qaytganlarni saralash (BE-17; TZ 6.6 OMB-1, OMB-2, OMB-3, OMB-6; T4 `inbound_shipment`,
 * `stock_lot`, `return_inspection`).
 */
export enum InboundShipmentStatus {
  DECLARED = 'DECLARED',
  IN_TRANSIT = 'IN_TRANSIT',
  RECEIVED = 'RECEIVED',
  DISCREPANCY = 'DISCREPANCY',
}

/** TZ OMB-3: yaroqlilik muddatiga shundan kam qolgan tovar sotuvga chiqmaydi. */
export const LOT_MIN_SHELF_DAYS = 60;

export const INBOUND_RPC = {
  DECLARE: 'inventory.inbound.declare',
  LIST: 'inventory.inbound.list',
  GET: 'inventory.inbound.get',
  IN_TRANSIT: 'inventory.inbound.in-transit',
  RECEIVE: 'inventory.inbound.receive',
  ACT_PDF: 'inventory.inbound.act-pdf',
  LOTS: 'inventory.lots.list',
  RETURN_GRADE: 'inventory.return.grade',
  RETURN_GET: 'inventory.return.get',
  DEFECT_ACT_PDF: 'inventory.return.defect-act-pdf',
} as const;

/** checkout → inventory (BE-25, FE-17): SKU yacheykasi (OMB-2) HQ omborda, variant bo‘yicha. */
export const INVENTORY_VARIANT_CELLS = 'inventory.variant-cells';

export interface InventoryVariantCell {
  variantId: string;
  cell: string | null;
}

/** inventory → catalog: CPA mahsulotining yagona faol varianti (SKU, shtrix-kod, optovik). */
export const CATALOG_INVENTORY_PRODUCTS = 'catalog.inventory.products';

export interface CatalogInventoryProduct {
  productId: string;
  productName: string;
  variantId: string;
  sku: string;
  barcode: string | null;
  wholesalerId: string;
  isBad: boolean;
}

/**
 * BE-47 (TZ 6.12): inventory → notification — postavka qabul qilindi (brak bo‘lsa soni bilan), optovik kabinetiga.
 * Bir postavkaga bitta xabar (`dedupeKey`).
 */
export const INBOUND_RECEIVED_EVENT = 'inventory.inbound.received';

export interface InboundReceivedEvent {
  shipmentId: string;
  number: string;
  wholesalerId: string;
  status: InboundShipmentStatus;
  declaredQty: number;
  receivedQty: number;
  defectiveQty: number;
}

/**
 * BE-47 (TZ 6.12): inventory → notification (outbox) — HQ dagi bo‘sh, sotuvga yaroqli qoldiq 0 bo‘ldi: band qilish,
 * tuzatish yoki hisobdan chiqarish, partiya muddati bloki. Xabar adminga va shu offerda sahifasi bor sotuvchilarga;
 * bir kunda bir variantga bitta [taklif]. (`inventory.stock_depleted` — boshqa hodisa: omborda umuman yo‘q, katalogga.)
 */
export const STOCK_DEPLETED_EVENT = 'inventory.offer.out-of-stock';

export interface StockDepletedEvent {
  variantIds: string[];
  /** ISO 8601 */
  at: string;
}

/** notification → lead-service: shu mahsulotda sahifasi (oqimi) bor sotuvchilar (BE-47). */
export const LEAD_OFFER_AFFILIATES_RPC = 'lead.offer.affiliates';

/** inventory → notification: partiya sotuvdan chiqdi (muddatga 60 kundan kam qoldi) — admin va superadminga. */
export const LOT_BLOCKED_EVENT = 'inventory.lot.blocked';

export interface LotBlockedEvent {
  lots: Array<{
    lotId: string;
    sku: string;
    productName: string;
    batch: string | null;
    expiryDate: string;
    sellableUntil: string;
    quantity: number;
  }>;
}

const ID = /^[1-9]\d{0,18}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export class DeclareInboundItemDto {
  @ApiProperty({ example: '42', description: 'CPA mahsulot' })
  @Matches(ID)
  productId: string;

  @ApiProperty({ example: 100 })
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  quantity: number;
}

export class DeclareInboundDto {
  @ApiProperty({ example: '15', description: 'Optovik (komitent)' })
  @Matches(ID)
  wholesalerId: string;

  @ApiProperty({ example: '2026-12-01', description: 'Kutilgan kelish sanasi' })
  @Matches(DAY, { message: 'expectedAt YYYY-MM-DD bo‘lishi kerak' })
  @IsDateString()
  expectedAt: string;

  @ApiPropertyOptional({ example: 'Haftalik postavka' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @ApiProperty({ type: [DeclareInboundItemDto] })
  @ValidateNested({ each: true })
  @Type(() => DeclareInboundItemDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  items: DeclareInboundItemDto[];
}

export class ReceiveInboundItemDto {
  @ApiProperty({ example: '7', description: 'Postavka qatori' })
  @Matches(ID)
  itemId: string;

  @ApiProperty({
    example: 100,
    description:
      'Kelgan (brak bilan birga); qabul — yaroqlisi: receivedQty − defectiveQty',
  })
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  receivedQty: number;

  @ApiProperty({ example: 2, description: 'Shundan brak' })
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  defectiveQty: number;

  @ApiPropertyOptional({ example: 'P-2026-11' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  batch?: string;

  @ApiPropertyOptional({
    example: '2027-06-30',
    description: 'Yaroqlilik muddati (BAD, kosmetika, oziq-ovqat)',
  })
  @IsOptional()
  @Matches(DAY, { message: 'expiryDate YYYY-MM-DD bo‘lishi kerak' })
  @IsDateString()
  expiryDate?: string;

  @ApiProperty({ example: 'B-02-1', description: 'Yacheyka manzili' })
  @IsString()
  @Matches(/^[A-Za-z0-9][A-Za-z0-9-]{0,31}$/, {
    message: 'Yacheyka: harf, raqam va «-», 32 belgigacha',
  })
  cell: string;
}

export class ReceiveInboundDto {
  @ApiProperty({ type: [ReceiveInboundItemDto] })
  @ValidateNested({ each: true })
  @Type(() => ReceiveInboundItemDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  items: ReceiveInboundItemDto[];

  @ApiPropertyOptional({ example: '2 dona qadog‘i yirtilgan' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}

/** `status=DECLARED,IN_TRANSIT` yoki `status=DECLARED&status=IN_TRANSIT`; bo‘sh — filtrsiz. */
const toStatusList = ({ value }: { value: unknown }): unknown => {
  if (value === undefined || value === null) return undefined;
  const list = (Array.isArray(value) ? value : [value])
    .flatMap((item) => String(item).split(','))
    .map((item) => item.trim())
    .filter(Boolean);
  return list.length ? [...new Set(list)] : undefined;
};

export class InboundShipmentQueryDto {
  @ApiPropertyOptional({
    enum: InboundShipmentStatus,
    isArray: true,
    description:
      'Bir yoki bir nechta holat: `status=DECLARED,IN_TRANSIT` yoki takroriy parametr',
  })
  @IsOptional()
  @Transform(toStatusList)
  @IsArray()
  @ArrayMaxSize(4)
  @IsIn(Object.values(InboundShipmentStatus), { each: true })
  status?: InboundShipmentStatus[];

  @ApiPropertyOptional({
    example: 'vitamin',
    description:
      'Postavka raqami (`PS-000014` yoki 14), mahsulot nomi, SKU, shtrix-kod yoki optovik nomi (BE-25)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({
    example: '2026-12-01',
    description: 'Kutilgan kelish sanasi, dan (BE-25)',
  })
  @IsOptional()
  @Matches(DAY, { message: 'expectedFrom YYYY-MM-DD bo‘lishi kerak' })
  @IsDateString()
  expectedFrom?: string;

  @ApiPropertyOptional({
    example: '2026-12-07',
    description: 'Kutilgan kelish sanasi, gacha (shu kun ham)',
  })
  @IsOptional()
  @Matches(DAY, { message: 'expectedTo YYYY-MM-DD bo‘lishi kerak' })
  @IsDateString()
  expectedTo?: string;

  @ApiPropertyOptional({
    example: '2026-12-01',
    description: 'Qabul qilingan kun (Toshkent)',
  })
  @IsOptional()
  @Matches(DAY, { message: 'receivedOn YYYY-MM-DD bo‘lishi kerak' })
  @IsDateString()
  receivedOn?: string;

  @ApiPropertyOptional({ example: '15' })
  @IsOptional()
  @Matches(ID)
  wholesalerId?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ example: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class LotsQueryDto {
  @ApiPropertyOptional({
    enum: ['BLOCKED', 'SELLABLE', 'ALL'],
    description: 'BLOCKED — sotuvdan chiqqan (60 kundan kam qolgan)',
  })
  @IsOptional()
  @IsIn(['BLOCKED', 'SELLABLE', 'ALL'])
  state?: 'BLOCKED' | 'SELLABLE' | 'ALL';
}

/**
 * Javob misollari (BE-25 TC3) bitta postavka bo‘yicha (BE-17 TC1): e’londa 100 dona, qabulda 100 keldi, 2 tasi brak —
 * «Farq bor», aktda qabul 98, farq −2; qoldiqqa va partiyaga 98 dona. Qabulgacha `received*`, `batch`, `expiryDate`, `cell` — `null`.
 */
export class InboundShipmentItemDto {
  @ApiProperty({ example: '7' }) id: string;
  @ApiProperty({ example: '42' }) productId: string;
  @ApiProperty({ example: 'Vitamin D3 2000 IU, 60 kapsula' })
  productName: string;
  @ApiProperty({ example: '901' }) variantId: string;
  @ApiProperty({ example: 'VIT-D3-60' }) sku: string;
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: '4780012345678',
  })
  barcode: string | null;
  @ApiProperty({ example: 100 }) declaredQty: number;
  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    example: 100,
    description:
      'Kelgan (brak bilan birga); aktdagi «Qabul» = receivedQty − defectiveQty',
  })
  receivedQty: number | null;
  @ApiPropertyOptional({ type: Number, nullable: true, example: 2 })
  defectiveQty: number | null;
  @ApiPropertyOptional({ type: String, nullable: true, example: 'P-2026-11' })
  batch: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, example: '2027-06-30' })
  expiryDate: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, example: 'B-02-1' })
  cell: string | null;
  @ApiPropertyOptional({
    nullable: true,
    type: Boolean,
    example: true,
    description:
      'BE-25 (OMB-3): muddat kuzatiladi — BAD mahsulot yoki toifa belgisi. Katalog javob bermasa null. Optovik kabinetida yo‘q',
  })
  expiryTracked?: boolean | null;
}

/** BE-25: ism maydonlari `admin/inventory/shipments*` da; katalog yoki identity javob bermasa — null. */
export class InboundShipmentDto {
  @ApiProperty({ example: '14' }) id: string;
  @ApiProperty({ example: 'PS-000014' }) number: string;
  @ApiProperty({ example: '15' }) wholesalerId: string;
  @ApiPropertyOptional({
    nullable: true,
    type: String,
    example: 'Gadget Trade MChJ',
  })
  wholesalerName?: string | null;
  @ApiProperty({
    enum: InboundShipmentStatus,
    example: InboundShipmentStatus.DISCREPANCY,
  })
  status: InboundShipmentStatus;
  @ApiProperty({ example: '2026-12-01' }) expectedAt: string;
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: 'Haftalik postavka',
  })
  note: string | null;
  @ApiProperty({ example: '3' }) declaredBy: string;
  @ApiPropertyOptional({ nullable: true, type: String, example: 'Nodira K.' })
  declaredByName?: string | null;
  @ApiPropertyOptional({
    nullable: true,
    enum: Role,
    example: Role.ADMIN,
    description: 'Kiritgan odam roli: optovik, omborchi, admin yoki superadmin',
  })
  declaredByRole?: Role | null;
  @ApiPropertyOptional({ type: String, nullable: true, example: '5' })
  receivedBy: string | null;
  @ApiPropertyOptional({ nullable: true, type: String, example: 'Jasur T.' })
  receivedByName?: string | null;
  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    nullable: true,
    example: '2026-12-01T06:40:00.000Z',
  })
  receivedAt: Date | null;
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: '2 dona qadog‘i yirtilgan',
  })
  receiveComment: string | null;
  @ApiProperty({ type: [InboundShipmentItemDto] })
  items: InboundShipmentItemDto[];
  @ApiProperty({ example: '2026-11-28T10:05:00.000Z' }) createdAt: Date;
}

export class InboundShipmentPageDto {
  @ApiProperty({ type: [InboundShipmentDto] }) items: InboundShipmentDto[];
  @ApiProperty({ example: 1 }) total: number;
  @ApiProperty({ example: 1 }) page: number;
  @ApiProperty({ example: 20 }) limit: number;
  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'number' },
    example: { DECLARED: 3, IN_TRANSIT: 1, RECEIVED: 12, DISCREPANCY: 2 },
    description:
      'BE-25: holatlar soni — `status` dan boshqa filtrlar bo‘yicha (yorliqlar)',
  })
  counts: Record<InboundShipmentStatus, number>;
}

export class StockLotDto {
  @ApiProperty({ example: '31' }) id: string;
  @ApiProperty({ example: '901' }) variantId: string;
  @ApiProperty({ example: 'VIT-D3-60' }) sku: string;
  @ApiProperty({ example: 'Vitamin D3 2000 IU, 60 kapsula' })
  productName: string;
  @ApiPropertyOptional({ type: String, nullable: true, example: 'P-2026-11' })
  batch: string | null;
  @ApiProperty({ example: '2027-06-30' }) expiryDate: string;
  @ApiProperty({
    description: 'Muddat − 60 kun; shundan keyin sotilmaydi',
    example: '2027-05-01',
  })
  sellableUntil: string;
  @ApiProperty({ example: 98 }) quantity: number;
  @ApiProperty({ example: false }) blocked: boolean;
  @ApiProperty({ example: '15' }) wholesalerId: string;
  @ApiPropertyOptional({
    nullable: true,
    type: String,
    example: 'Gadget Trade MChJ',
    description: 'BE-25: katalog javob bermasa null',
  })
  wholesalerName?: string | null;
  @ApiProperty({
    nullable: true,
    type: String,
    format: 'date-time',
    example: null,
    description:
      'BE-25 (OMB-3): sotuvdan chiqqani haqida admin va superadminga xabar vaqti; hali yuborilmagan — null',
  })
  notifiedAt: Date | null;
}

export class GradeReturnItemDto {
  @ApiProperty({ example: '901' })
  @Matches(ID)
  variantId: string;

  @ApiProperty({ example: 1, description: 'Sotiladigan (qoldiqqa qaytadi)' })
  @IsInt()
  @Min(0)
  @Max(10_000)
  sellable: number;

  @ApiProperty({ example: 0, description: 'Brak (optovikka qaytariladi)' })
  @IsInt()
  @Min(0)
  @Max(10_000)
  defective: number;
}

export class GradeReturnDto {
  @ApiProperty({ type: [GradeReturnItemDto] })
  @ValidateNested({ each: true })
  @Type(() => GradeReturnItemDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  items: GradeReturnItemDto[];

  @ApiPropertyOptional({ example: 'Qadog‘i ezilgan' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}

export class ReturnInspectionDto {
  @ApiProperty({ example: '1284' }) orderId: string;
  @ApiPropertyOptional({ type: String, nullable: true, example: '1190' })
  parcelId: string | null;
  @ApiProperty({
    type: 'array',
    items: {
      type: 'object',
      properties: {
        variantId: { type: 'string' },
        sellable: { type: 'number' },
        defective: { type: 'number' },
      },
    },
    example: [{ variantId: '901', sellable: 1, defective: 1 }],
  })
  items: Array<{ variantId: string; sellable: number; defective: number }>;
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: 'Qadog‘i ezilgan',
  })
  comment: string | null;
  @ApiProperty({ example: '5' }) inspectedBy: string;
  @ApiProperty({ example: '2026-12-08T09:30:00.000Z' }) inspectedAt: Date;
}

/** BE-25 (FE-12): admin mahsulotlar ro‘yxati — variantlar bo‘yicha HQ qoldig‘i va yo‘ldagi postavka. */
export const INVENTORY_STOCK_SUMMARY = 'inventory.stock.summary';

export interface InventoryVariantStock {
  onHand: number;
  reserved: number;
  /** omborda − band − muddati sabab to‘silgan (`inventory.available` bilan bir xil). */
  available: number;
  /** E’lon qilingan va yo‘ldagi postavkalarda. */
  incoming: number;
}
