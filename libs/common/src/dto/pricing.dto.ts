import { ApiProperty, ApiPropertyOptional, PickType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { MAX_MONEY } from '../database/money.transformer';
import { DeliveryDisplayMode, PriceStatus } from '../pricing/price-calculator';

const money = (min = 0) => [
  Type(() => Number),
  IsInt(),
  Min(min),
  Max(MAX_MONEY),
];
const apply =
  (...decorators: PropertyDecorator[]): PropertyDecorator =>
  (target, key) =>
    decorators.forEach((d) => d(target, key));

/** `GET /admin/products/:id/pricing` — admin kiritayotgan narx va sotuvchi haqi (bo‘sh — tasdiqlangan yoki tavsiya). */
export class PricingQueryDto {
  @ApiPropertyOptional({ example: 255000 })
  @IsOptional()
  @apply(...money(1))
  price?: number;

  @ApiPropertyOptional({ example: 65000 })
  @IsOptional()
  @apply(...money())
  affiliateFee?: number;
}

/** `POST /admin/products/:id/price-decision` — narxni tasdiqlash (NRX-6). */
export class PriceDecisionDto {
  @ApiProperty({
    example: 262000,
    description: 'Mijoz ko‘radigan tovar narxi (tavsiya yoki admin narxi)',
  })
  @apply(...money(1))
  price: number;

  @ApiPropertyOptional({
    example: 65000,
    description: 'Sotuvchi haqi (NRX-3, NRX-13); berilmasa — mahsulotdagi',
  })
  @IsOptional()
  @apply(...money())
  affiliateFee?: number;

  @ApiPropertyOptional({
    example: 'Raqobatchi narxi past, pilot uchun',
    description: 'To‘q sariq holatda majburiy',
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(1000)
  reason?: string;
}

/** `POST /admin/products/:id/market-check` — NRX-5: raqobatchida mijoz jami to‘laydigan summa. */
export class MarketCheckDto {
  @ApiProperty({ example: 290000 })
  @apply(...money(1))
  competitorTotal: number;

  @ApiPropertyOptional({
    example: 'Uzum Market, 2026-12-01',
    description: 'BE-25 (FE-13): qayerda ko‘rildi',
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(300)
  source?: string;

  @ApiPropertyOptional({
    example: false,
    description: 'BE-25 (FE-13): true — natija saqlanmaydi (oldindan ko‘rish)',
  })
  @IsOptional()
  @IsBoolean()
  preview?: boolean;
}

/**
 * Narx parametrlari (ADM-2). Kategoriya va mahsulot darajasida `null` — yuqori darajadan olinadi; global darajada
 * bo‘sh qoldirib bo‘lmaydi.
 */
export class PricePolicyDto {
  @ApiPropertyOptional({
    example: 'Superadmin so‘rovi (Shodiyor, 2026-11-22): Elchi tarifi oshdi',
    description: 'BE-27: izoh — kim so‘radi va sabab; faqat auditga yoziladi',
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  comment?: string;

  @ApiPropertyOptional({
    example: 29688,
    nullable: true,
    description: 'K, sotilish 70% (2 xonagacha kasr)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(MAX_MONEY)
  kSale70?: number | null;

  @ApiPropertyOptional({
    example: 15232,
    nullable: true,
    description: 'K, sotilish 100% (2 xonagacha kasr)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(MAX_MONEY)
  kSale100?: number | null;

  @ApiPropertyOptional({ example: 9000, nullable: true, description: 'M' })
  @IsOptional()
  @apply(...money())
  targetMargin?: number | null;

  @ApiPropertyOptional({ example: 0.04, nullable: true })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(0.5)
  taxRate?: number | null;

  @ApiPropertyOptional({ example: 0.0185, nullable: true })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(0.5)
  paymentRate?: number | null;

  @ApiPropertyOptional({ example: 12000, nullable: true })
  @IsOptional()
  @apply(...money())
  callCenterFee?: number | null;

  @ApiPropertyOptional({ example: 1.29, nullable: true })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(100)
  affiliateCoef?: number | null;

  @ApiPropertyOptional({
    example: 50420,
    nullable: true,
    description: 'Sotuvchining reklama xarajati',
  })
  @IsOptional()
  @apply(...money())
  adCost?: number | null;

  @ApiPropertyOptional({
    example: 10,
    nullable: true,
    description: 'Ustama chegarasi, %',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  markupCapPercent?: number | null;

  @ApiPropertyOptional({ enum: DeliveryDisplayMode, nullable: true })
  @IsOptional()
  @IsEnum(DeliveryDisplayMode)
  deliveryMode?: DeliveryDisplayMode | null;

  @ApiPropertyOptional({
    example: 30000,
    nullable: true,
    description: 'Ko‘rinadigan yetkazish, markazgacha',
  })
  @IsOptional()
  @apply(...money())
  visibleCenter?: number | null;

  @ApiPropertyOptional({
    example: 50000,
    nullable: true,
    description: 'Ko‘rinadigan yetkazish, eshikkacha',
  })
  @IsOptional()
  @apply(...money())
  visibleAddress?: number | null;
}

/** `POST /admin/pricing/elchi-tariffs` — yangi Elchi tarifi (NRX-7), kuchga kirish vaqti bilan. */
export class ElchiTariffDto {
  @ApiPropertyOptional({
    example: 'Superadmin so‘rovi (Shodiyor, 2026-11-22): Elchi tarifi oshdi',
    description: 'BE-27: izoh — kim so‘radi va sabab; faqat auditga yoziladi',
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  comment?: string;

  @ApiProperty({ example: 40000 })
  @apply(...money())
  centerBase: number;

  @ApiProperty({ example: 3000 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  baseWeightGrams: number;

  @ApiProperty({ example: 4000 })
  @apply(...money())
  perExtraKg: number;

  @ApiProperty({ example: 20000 })
  @apply(...money())
  addressExtra: number;

  @ApiPropertyOptional({
    example: '2026-12-01T00:00:00+05:00',
    description: 'Berilmasa — hozirdan',
  })
  @IsOptional()
  @IsDateString()
  effectiveFrom?: string;
}

/** Misol: TZ 2.6 chegaralari (B = 140 000, A = 65 000, qisman) — 249 000 to‘q sariq (235 828 dan 251 183 gacha). */
export class PriceDecisionViewDto {
  @ApiProperty({ example: '58' }) id: string;
  @ApiProperty({ example: '42' }) productId: string;
  @ApiProperty({ example: 249000 }) price: number;
  @ApiProperty({ example: 140000 }) basePrice: number;
  @ApiProperty({ example: 65000 }) affiliateFee: number;
  @ApiProperty({ example: 262000 }) recommended: number;
  @ApiProperty({ enum: PriceStatus, example: PriceStatus.ORANGE })
  status: PriceStatus;
  @ApiProperty({
    nullable: true,
    type: String,
    example: 'Raqobatchi narxi past, pilot uchun',
  })
  reason: string | null;
  @ApiProperty({ example: '3' }) decidedBy: string;
  @ApiProperty({ example: '2026-11-21T10:02:00.000Z' }) createdAt: Date;
}

/**
 * `PUT /admin/products/:id/price-policy` — admin mahsulot uchun faqat yetkazish ko‘rinishini tanlaydi (TZ 2.4);
 * K, M, foizlar va boshqa pul parametrlari — superadmin sozlamasi (TZ 3: «Narx kalkulyatori … sozlamalari»).
 */
export class ProductPricePolicyDto extends PickType(PricePolicyDto, [
  'deliveryMode',
  'visibleCenter',
  'visibleAddress',
  'comment',
] as const) {}
