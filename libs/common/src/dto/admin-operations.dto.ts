import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { SalesOrderSellerStatus, StockMovementType } from '../enums';
import { StockQueryDto } from './inventory.dto';

/**
 * Query string'dagi 'true'/'false' → boolean; berilmasa undefined qoladi.
 *
 * C6.7 — `warehouseActive` qoldiq va harakatlarda BIR XIL: sukut bo'yicha
 * barcha omborlar (o'chirilganlari ham), qatorda `warehouseActive` bor.
 * Avval qoldiq faqat faol omborni, harakatlar esa hammasini ko'rsatardi.
 */
const toOptionalBoolean = ({ value }: { value: unknown }) =>
  value === true || value === 'true'
    ? true
    : value === false || value === 'false'
      ? false
      : value;

export class AdminStockQueryDto extends StockQueryDto {
  @ApiPropertyOptional({ example: '15' })
  @IsOptional()
  @Matches(/^[1-9]\d*$/, { message: "shopId musbat son bo'lishi kerak" })
  shopId?: string;

  @ApiPropertyOptional({
    example: true,
    description: 'true — faqat faol, false — faqat o‘chirilgan omborlar',
  })
  @IsOptional()
  @Transform(toOptionalBoolean)
  @IsBoolean()
  warehouseActive?: boolean;
}

/** Katalog ma'lumoti (nom/SKU) — katalog javob bermasa yoki variant o'chirilgan bo'lsa null. */
class AdminVariantInfoDto {
  @ApiProperty({ example: '88' }) variantId: string;
  @ApiProperty({ example: '12', nullable: true }) productId: string | null;
  @ApiProperty({ example: 'iPhone 16 Pro', nullable: true })
  productName: string | null;
  @ApiProperty({ example: 'Qora / 256 GB', nullable: true })
  variantName: string | null;
  @ApiProperty({ example: 'IPHONE-16-BLACK-256', nullable: true })
  sku: string | null;
  @ApiProperty({
    example: false,
    description:
      'true — katalogda variant topilmadi (o‘chirilgan). Qator baribir qaytadi.',
  })
  catalogMissing: boolean;
}

export class AdminStockItemDto extends AdminVariantInfoDto {
  /** BE-16: mahsulot optovigi (qoldiq egasi); ombor bitta — HQ. */
  @ApiProperty({ example: '15', nullable: true, type: String })
  shopId: string | null;
  @ApiProperty({ example: '3' }) warehouseId: string;
  @ApiProperty({ example: 'Asosiy ombor' }) warehouseName: string;
  @ApiProperty({ example: true }) warehouseActive: boolean;
  @ApiProperty({ example: 15 }) onHand: number;
  @ApiProperty({ example: 3 }) reserved: number;
  @ApiProperty({ example: 12 }) available: number;
  @ApiProperty({ example: 5 }) lowStockThreshold: number;
}

/** Katalog so'rovi yiqilgan do'kon — uning qatorlari nomsiz qaytadi. */
export class AdminCatalogWarningDto {
  @ApiProperty({ example: null, nullable: true, type: String })
  shopId: string | null;
  @ApiProperty({ example: 'Mikroservis belgilangan vaqtda javob bermadi' })
  reason: string;
}

export class AdminStockPageDto {
  @ApiProperty({ type: [AdminStockItemDto] }) items: AdminStockItemDto[];
  @ApiProperty({ example: 25 }) total: number;
  @ApiProperty({ example: 1 }) page: number;
  @ApiProperty({ example: 20 }) limit: number;
  @ApiProperty({ example: 2 }) totalPages: number;
  @ApiProperty({ type: [AdminCatalogWarningDto] })
  warnings: AdminCatalogWarningDto[];
  @ApiProperty({
    example: false,
    description:
      'true — qidiruvga mos variant juda ko‘p, natija qisqartirildi; so‘rovni aniqlashtiring',
  })
  searchTruncated: boolean;
}

class AdminPageQueryDto {
  @ApiPropertyOptional({ example: 1, default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ example: 20, default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}

export class AdminStockMovementsQueryDto extends AdminPageQueryDto {
  @ApiPropertyOptional({
    example: true,
    description: 'true — faqat faol, false — faqat o‘chirilgan omborlar',
  })
  @IsOptional()
  @Transform(toOptionalBoolean)
  @IsBoolean()
  warehouseActive?: boolean;

  @ApiPropertyOptional({ example: '15' })
  @IsOptional()
  @Matches(/^[1-9]\d*$/)
  shopId?: string;

  @ApiPropertyOptional({ example: '3' })
  @IsOptional()
  @Matches(/^[1-9]\d*$/)
  warehouseId?: string;

  @ApiPropertyOptional({ example: '88' })
  @IsOptional()
  @Matches(/^[1-9]\d*$/)
  variantId?: string;

  @ApiPropertyOptional({ enum: StockMovementType })
  @IsOptional()
  @IsEnum(StockMovementType)
  type?: StockMovementType;

  @ApiPropertyOptional({ example: '2026-09-01T00:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional({ example: '2026-09-30T23:59:59.999Z' })
  @IsOptional()
  @IsDateString()
  dateTo?: string;
}

export const ADMIN_SHIPMENT_STATES = ['all', 'created', 'missing'] as const;
export type AdminShipmentState = (typeof ADMIN_SHIPMENT_STATES)[number];

export class AdminShipmentsQueryDto extends AdminPageQueryDto {
  @ApiPropertyOptional({
    enum: ADMIN_SHIPMENT_STATES,
    default: 'all',
    description:
      'created — Elchi posilkasi bor; missing — Elchi’ga topshirilmagan, ' +
      'lekin topshirilishi kerak (buyurtma tasdiqlangan/to‘langan, ' +
      'sub-buyurtma yakunlanmagan); all — hammasi',
  })
  @IsOptional()
  @IsIn(ADMIN_SHIPMENT_STATES)
  shipmentState?: AdminShipmentState;

  @ApiPropertyOptional({ example: '15' })
  @IsOptional()
  @Matches(/^[1-9]\d*$/)
  shopId?: string;

  @ApiPropertyOptional({ enum: SalesOrderSellerStatus })
  @IsOptional()
  @IsEnum(SalesOrderSellerStatus)
  status?: SalesOrderSellerStatus;

  @ApiPropertyOptional({ example: '1251131' })
  @IsOptional()
  @Matches(/^[1-9]\d*$/)
  shipmentId?: string;

  @ApiPropertyOptional({ example: '2026-09-01T00:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional({ example: '2026-09-30T23:59:59.999Z' })
  @IsOptional()
  @IsDateString()
  dateTo?: string;
}

export class AdminWebhooksQueryDto extends AdminPageQueryDto {
  @ApiPropertyOptional({ example: 'evt_123' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  eventId?: string;

  @ApiPropertyOptional({ example: '1251131' })
  @IsOptional()
  @Matches(/^[1-9]\d*$/)
  shipmentId?: string;

  @ApiPropertyOptional({ example: '9' })
  @IsOptional()
  @Matches(/^[1-9]\d*$/)
  sellerOrderId?: string;

  @ApiPropertyOptional({ enum: SalesOrderSellerStatus })
  @IsOptional()
  @IsEnum(SalesOrderSellerStatus)
  status?: SalesOrderSellerStatus;

  @ApiPropertyOptional({ example: '2026-09-01T00:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional({ example: '2026-09-30T23:59:59.999Z' })
  @IsOptional()
  @IsDateString()
  dateTo?: string;
}

export class AdminStockMovementItemDto extends AdminVariantInfoDto {
  @ApiProperty() id: string;
  /** BE-16: mahsulot optovigi. */
  @ApiProperty({ nullable: true, type: String }) shopId: string | null;
  @ApiProperty() warehouseId: string;
  @ApiProperty() warehouseName: string;
  @ApiProperty() warehouseActive: boolean;
  @ApiProperty({ enum: StockMovementType }) type: StockMovementType;
  @ApiProperty() quantity: number;
  @ApiProperty() onHandAfter: number;
  @ApiProperty() reservedAfter: number;
  @ApiProperty({ nullable: true }) referenceType: string | null;
  @ApiProperty({ nullable: true }) referenceId: string | null;
  @ApiProperty({ nullable: true }) reason: string | null;
  @ApiProperty({ nullable: true }) actorId: string | null;
  @ApiProperty() createdAt: Date;
}

export class AdminStockMovementsPageDto {
  @ApiProperty({ type: [AdminStockMovementItemDto] })
  items: AdminStockMovementItemDto[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
  @ApiProperty() totalPages: number;
  @ApiProperty({ type: [AdminCatalogWarningDto] })
  warnings: AdminCatalogWarningDto[];
}

/**
 * BE-16: HQ omborga tovar kirimi (omborchi). To‘liq qabul akti va brak — BE-17; shungacha vaqtinchalik yo‘l [taklif].
 */
export class AdminStockInboundDto {
  @ApiProperty({ example: '501' })
  @Matches(/^[1-9]\d*$/, { message: "variantId musbat son bo'lishi kerak" })
  variantId: string;

  @ApiProperty({ example: 20, minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  quantity: number;

  @ApiProperty({ example: 'Postavka № 12, optovik Gadget Trade' })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason: string;

  @ApiPropertyOptional({ description: 'Takror yuborishdan himoya' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  idempotencyKey?: string;
}

/** BE-16: HQ qoldig‘ini tuzatish (inventarizatsiya); band qilingandan kam bo‘lmaydi. */
export class AdminStockAdjustDto {
  @ApiProperty({ example: '501' })
  @Matches(/^[1-9]\d*$/, { message: "variantId musbat son bo'lishi kerak" })
  variantId: string;

  @ApiProperty({ example: -1, description: 'Noldan farqli butun son' })
  @Type(() => Number)
  @IsInt()
  @Min(-1_000_000)
  @Max(1_000_000)
  delta: number;

  @ApiProperty({ example: 'Inventarizatsiya: 1 dona kam' })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  idempotencyKey?: string;
}
