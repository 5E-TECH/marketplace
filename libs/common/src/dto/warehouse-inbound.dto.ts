import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
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

  @ApiProperty({ example: 98, description: 'Kelgan (brak bilan birga)' })
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

export class InboundShipmentQueryDto {
  @ApiPropertyOptional({ enum: InboundShipmentStatus })
  @IsOptional()
  @IsIn(Object.values(InboundShipmentStatus))
  status?: InboundShipmentStatus;

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

export class InboundShipmentItemDto {
  @ApiProperty() id: string;
  @ApiProperty() productId: string;
  @ApiProperty() productName: string;
  @ApiProperty() variantId: string;
  @ApiProperty() sku: string;
  @ApiPropertyOptional({ nullable: true }) barcode: string | null;
  @ApiProperty() declaredQty: number;
  @ApiPropertyOptional({ nullable: true }) receivedQty: number | null;
  @ApiPropertyOptional({ nullable: true }) defectiveQty: number | null;
  @ApiPropertyOptional({ nullable: true }) batch: string | null;
  @ApiPropertyOptional({ nullable: true }) expiryDate: string | null;
  @ApiPropertyOptional({ nullable: true }) cell: string | null;
}

export class InboundShipmentDto {
  @ApiProperty() id: string;
  @ApiProperty() number: string;
  @ApiProperty() wholesalerId: string;
  @ApiProperty({ enum: InboundShipmentStatus }) status: InboundShipmentStatus;
  @ApiProperty() expectedAt: string;
  @ApiPropertyOptional({ nullable: true }) note: string | null;
  @ApiProperty() declaredBy: string;
  @ApiPropertyOptional({ nullable: true }) receivedBy: string | null;
  @ApiPropertyOptional({ nullable: true }) receivedAt: Date | null;
  @ApiPropertyOptional({ nullable: true }) receiveComment: string | null;
  @ApiProperty({ type: [InboundShipmentItemDto] })
  items: InboundShipmentItemDto[];
  @ApiProperty() createdAt: Date;
}

export class InboundShipmentPageDto {
  @ApiProperty({ type: [InboundShipmentDto] }) items: InboundShipmentDto[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
}

export class StockLotDto {
  @ApiProperty() id: string;
  @ApiProperty() variantId: string;
  @ApiProperty() sku: string;
  @ApiProperty() productName: string;
  @ApiPropertyOptional({ nullable: true }) batch: string | null;
  @ApiProperty() expiryDate: string;
  @ApiProperty({ description: 'Muddat − 60 kun; shundan keyin sotilmaydi' })
  sellableUntil: string;
  @ApiProperty() quantity: number;
  @ApiProperty() blocked: boolean;
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
  @ApiProperty() orderId: string;
  @ApiPropertyOptional({ nullable: true }) parcelId: string | null;
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
  })
  items: Array<{ variantId: string; sellable: number; defective: number }>;
  @ApiPropertyOptional({ nullable: true }) comment: string | null;
  @ApiProperty() inspectedBy: string;
  @ApiProperty() inspectedAt: Date;
}
