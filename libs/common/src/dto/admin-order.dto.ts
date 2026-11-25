import {
  ApiProperty,
  ApiPropertyOptional,
  OmitType,
  PickType,
} from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { MAX_MONEY } from '../database/money.transformer';
import { SalesOrderStatus } from '../enums';
import { CheckoutDeliveryDestination, CheckoutPaymentMethod } from './cart.dto';
import { IsLeadBigintId, LeadSource, trimLeadText } from './lead.dto';
import { LeadOrderStatus } from './order-events.dto';

/** BE-18: eski buyurtma holatlari va lid buyurtmasi holatlari (TZ T5) — bitta filtrda. */
export const ADMIN_ORDER_STATUSES = [
  ...new Set<string>([
    ...Object.values(SalesOrderStatus),
    ...Object.values(LeadOrderStatus),
  ]),
];

/** «Holat · o‘zgardi» bo‘yicha saralash (BE-25, FE-26). */
export enum AdminOrderSort {
  STATUS_AT_ASC = 'statusAt',
  STATUS_AT_DESC = '-statusAt',
}

/** C1.30 — `GET /admin/orders` — status/to'lov/do'kon/sana filtri + sahifalash. */
export class AdminOrdersQueryDto {
  @ApiPropertyOptional({ enum: ADMIN_ORDER_STATUSES })
  @IsOptional()
  @IsIn(ADMIN_ORDER_STATUSES)
  status?: SalesOrderStatus | LeadOrderStatus;

  @ApiPropertyOptional({
    enum: LeadSource,
    description:
      'BE-18: liddan buyurtma manbasi (sotuvchi sahifasi, asosiy sayt, API)',
  })
  @IsOptional()
  @IsEnum(LeadSource)
  source?: LeadSource;

  @ApiPropertyOptional({ enum: CheckoutPaymentMethod })
  @IsOptional()
  @IsEnum(CheckoutPaymentMethod)
  paymentMethod?: CheckoutPaymentMethod;

  @ApiPropertyOptional({ example: '15' })
  @IsOptional()
  @IsString()
  shopId?: string;

  @ApiPropertyOptional({ example: '2026-08-01' })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional({ example: '2026-08-31' })
  @IsOptional()
  @IsDateString()
  dateTo?: string;

  // ── BE-25 (FE-26) ──
  @ApiPropertyOptional({
    example: 'L-1276',
    maxLength: 100,
    description:
      'Buyurtma yoki lid raqami, mijoz ismi, Elchi treki. Telefon bo‘yicha qidiruv yo‘q (134-savol)',
  })
  @IsOptional()
  @Transform(trimLeadText)
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ example: '501' })
  @IsOptional()
  @IsLeadBigintId('productId')
  productId?: string;

  @ApiPropertyOptional({ example: '77', description: 'Sotuvchi ID si' })
  @IsOptional()
  @IsLeadBigintId('affiliateId')
  affiliateId?: string;

  @ApiPropertyOptional({ example: '1726', description: 'Viloyat SOATO kodi' })
  @IsOptional()
  @Matches(/^\d{4,10}$/)
  regionSoato?: string;

  @ApiPropertyOptional({ enum: CheckoutDeliveryDestination })
  @IsOptional()
  @IsEnum(CheckoutDeliveryDestination)
  whereDeliver?: CheckoutDeliveryDestination;

  @ApiPropertyOptional({ example: '41', description: 'Tasdiqlagan operator' })
  @IsOptional()
  @IsLeadBigintId('confirmedById')
  confirmedById?: string;

  @ApiPropertyOptional({
    example: true,
    type: Boolean,
    description: 'Javobda `counts` — holat bo‘yicha sonlar (holat filtrisiz)',
  })
  @IsOptional()
  @Transform(({ obj }: { obj: Record<string, unknown> }) => {
    const raw = obj.withCounts;
    return raw === 'true' ? true : raw === 'false' ? false : raw;
  })
  @IsBoolean()
  withCounts?: boolean;

  @ApiPropertyOptional({
    enum: AdminOrderSort,
    description: 'Berilmasa — yaratilgan vaqti bo‘yicha, yangisi tepada',
  })
  @IsOptional()
  @IsEnum(AdminOrderSort)
  sort?: AdminOrderSort;

  @ApiPropertyOptional({ example: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ example: 20, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;
}

/** `GET /operator/orders`: operator o‘zi tasdiqlagan buyurtmalar (BE-25, FE-26). */
export class OperatorOrdersQueryDto extends PickType(AdminOrdersQueryDto, [
  'search',
  'productId',
  'whereDeliver',
  'dateFrom',
  'dateTo',
  'withCounts',
  'sort',
  'page',
  'limit',
] as const) {
  @ApiPropertyOptional({ enum: LeadOrderStatus })
  @IsOptional()
  @IsEnum(LeadOrderStatus)
  status?: LeadOrderStatus;
}

/** Buyurtmani kim ko‘ryapti (gateway tokenidan). */
export interface OrderViewer {
  kind: 'ADMIN' | 'SUPERVISOR' | 'OPERATOR';
  userId: string;
}

/** Sabab bilan bajariladigan amal (yorliqni qayta chop etish, nizoli belgisi). */
export class OrderReasonDto {
  @ApiProperty({ example: 'Yorliq yirtilgan', maxLength: 500 })
  @Transform(trimLeadText)
  @IsString()
  @IsNotEmpty({ message: 'reason sabab majburiy' })
  @MaxLength(500)
  reason: string;
}

export class OrderCommentDto {
  @ApiPropertyOptional({ example: 'Mijoz bilan kelishildi', maxLength: 500 })
  @IsOptional()
  @Transform(trimLeadText)
  @IsString()
  @MaxLength(500)
  comment?: string;
}

export class LabelReprintDto {
  @ApiProperty({ example: '2027-01-14T09:40:00.000Z' }) printedAt: string;
  @ApiProperty({ example: 'Nodira K.' }) by: string;
  @ApiProperty({ example: 2, description: 'Necha marta qayta chop etilgan' })
  count: number;
}

export class OrderDisputeDto {
  @ApiProperty({ example: '2027-01-14T09:40:00.000Z' }) at: string;
  @ApiProperty({ example: 'Nodira K.' }) by: string;
  @ApiProperty({ example: 'Mijoz tovar kelmadi deydi' }) reason: string;

  @ApiProperty({
    example: '2028-01-14T09:40:00.000Z',
    description: 'Qo‘ng‘iroq yozuvi shu sanagacha saqlanadi (TEL-6: 1 yil)',
  })
  keepUntil: string;
}

export class OrderDisputeClosedDto {
  @ApiProperty({ example: '1042' }) orderId: string;
  @ApiProperty({ example: '2027-01-20T09:40:00.000Z' }) closedAt: string;
}

export class ElchiResendDto {
  @ApiProperty({ example: '1042' }) orderId: string;
  @ApiProperty({ example: 'PENDING', description: 'Posilka so‘rovi holati' })
  elchiState: string;
}

/** Elchi’dagi joriy holat; `applied` — buyurtma holati yangilandimi (faqat oldinga, BE-21 qoidasi). */
export class ElchiRefreshDto {
  @ApiProperty({ example: '1042' }) orderId: string;
  @ApiProperty({ example: 'on_the_road', nullable: true, type: String })
  elchiStatus: string | null;
  @ApiProperty({ example: 'IN_TRANSIT' }) status: string;
  @ApiProperty({ example: true }) applied: boolean;
  @ApiProperty({
    example: null,
    nullable: true,
    type: String,
    description: 'Holat nega o‘zgarmadi',
  })
  detail: string | null;
}

/** CSV ustunlari (FE-26 «CSV eksport», admin-buyurtmalar). */
export enum OrderExportColumn {
  ORDER = 'order',
  CUSTOMER = 'customer',
  PHONE = 'phone',
  STREAM = 'stream',
  SOURCE = 'source',
  AMOUNT = 'amount',
  STATUS = 'status',
  TRACK = 'track',
  PRICE_SNAPSHOT = 'priceSnapshot',
  SUBS = 'subs',
}

/** Ro‘yxat filtrlari, sahifalash va saralashsiz. */
export class OrderExportFilterDto extends OmitType(AdminOrdersQueryDto, [
  'page',
  'limit',
  'sort',
  'withCounts',
] as const) {}

export class OrderExportRequestDto {
  @ApiProperty({ type: OrderExportFilterDto })
  @ValidateNested()
  @Type(() => OrderExportFilterDto)
  @IsNotEmpty()
  filters: OrderExportFilterDto;

  @ApiProperty({
    enum: OrderExportColumn,
    isArray: true,
    example: [OrderExportColumn.ORDER, OrderExportColumn.CUSTOMER],
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @ArrayMaxSize(Object.keys(OrderExportColumn).length)
  @IsEnum(OrderExportColumn, { each: true })
  columns: OrderExportColumn[];

  @ApiPropertyOptional({ enum: ['LAST4', 'FULL'], default: 'LAST4' })
  @IsOptional()
  @IsIn(['LAST4', 'FULL'])
  phone?: 'LAST4' | 'FULL';
}

export interface OrderExportChunkInput {
  filters: OrderExportFilterDto;
  columns: OrderExportColumn[];
  until: string;
  afterId: string | null;
}

export class AdminOrderActionDto {
  @ApiProperty({ example: 'Mahsulot mavjud emas' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason: string;
}

/** `cancel` va `refund` javoblari bir xil shaklda. */
export class OrderActionResultDto {
  @ApiProperty({ example: '42' })
  id: string;

  @ApiProperty({ enum: ['CANCELLED', 'REFUNDED'], example: 'REFUNDED' })
  status: string;

  @ApiProperty({
    example: false,
    description:
      'true — buyurtma allaqachon shu holatda edi va hech qanday yangi ' +
      'yon ta’sir bo‘lmadi (provayderga refund takror yuborilmaydi).',
  })
  idempotent: boolean;
}

export class AdminOrderRefundDto extends AdminOrderActionDto {
  @ApiPropertyOptional({
    example: 125000,
    description:
      'Hozir faqat to‘liq refund: summa order totaliga teng bo‘lishi kerak',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt() // BE-01: pul — butun so‘m
  @Max(MAX_MONEY)
  @Min(1)
  amount?: number;
}

/**
 * C1.45 — posilka QR tokenlarini Elchi bilan tenglashtirish (backfill).
 * Kursorli: javobdagi `nextAfterId` keyingi chaqiruvga `afterId` bo'lib
 * beriladi, `null` bo'lsa tugadi.
 */
export class AdminShipmentTokensSyncDto {
  @ApiPropertyOptional({
    example: '0',
    description: 'Shu seller-order id dan keyingilar',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d+$/)
  afterId?: string;

  @ApiPropertyOptional({ example: 20, minimum: 1, maximum: 50 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  @ApiPropertyOptional({
    example: true,
    description:
      'true — hech narsa yozilmaydi, faqat nima o‘zgarishi ko‘rsatiladi',
  })
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;
}
