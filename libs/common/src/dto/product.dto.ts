import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { MAX_MONEY } from '../database/money.transformer';
import {
  ApiProperty,
  ApiPropertyOptional,
  IntersectionType,
  PartialType,
} from '@nestjs/swagger';
import { ProductStatus } from '../enums';
import { DeliveryDisplayMode } from '../pricing/price-calculator';

/** Og‘irlik (g) va o‘lcham (mm) uchun texnik yuqori chegara — INTEGER ustuni (2^31 − 1). */
const MAX_DIMENSION = 2_147_483_647;

export class CreateProductDto {
  @ApiProperty({ example: 'iPhone 16 Pro' })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name: string;

  @ApiPropertyOptional({ type: String, example: '1', nullable: true })
  @IsOptional()
  @Matches(/^\d+$/, { message: "categoryId musbat son bo'lishi kerak" })
  categoryId?: string | null;

  @ApiPropertyOptional({
    type: String,
    example: 'Titanium, 256 GB',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  description?: string | null;

  /** Eski «narx» maydoni; berilmasa bazaviy narx (B). Sotuv narxi — BE-09 (narx kalkulyatori va tasdiq). */
  @ApiPropertyOptional({ example: 140000, minimum: 0 })
  @IsOptional()
  @IsInt() // BE-01: pul — butun so‘m
  @Max(MAX_MONEY)
  @Min(0)
  price?: number;

  @ApiProperty({
    example: 140000,
    minimum: 0,
    description: 'Optovikning bazaviy narxi (B), butun so‘m (OPT-2, TZ 2.1)',
  })
  @IsInt()
  @Max(MAX_MONEY)
  @Min(0)
  basePrice: number;

  @ApiPropertyOptional({
    type: Number,
    example: 65000,
    minimum: 0,
    nullable: true,
    description:
      'Sotuvchi haqi (A), so‘m, har offer uchun (TZ 1-bo‘lim 8-qaror)',
  })
  @IsOptional()
  @IsInt()
  @Max(MAX_MONEY)
  @Min(0)
  affiliateFee?: number | null;

  @ApiProperty({
    example: 450,
    minimum: 1,
    description: 'Bir dona og‘irligi, gramm (OPT-2, BUY-4)',
  })
  @IsInt()
  @Min(1)
  @Max(MAX_DIMENSION)
  weightGrams: number;

  @ApiProperty({ example: 200, minimum: 1, description: 'Uzunlik, mm' })
  @IsInt()
  @Min(1)
  @Max(MAX_DIMENSION)
  lengthMm: number;

  @ApiProperty({ example: 120, minimum: 1, description: 'Kenglik, mm' })
  @IsInt()
  @Min(1)
  @Max(MAX_DIMENSION)
  widthMm: number;

  @ApiProperty({ example: 80, minimum: 1, description: 'Balandlik, mm' })
  @IsInt()
  @Min(1)
  @Max(MAX_DIMENSION)
  heightMm: number;

  @ApiPropertyOptional({
    type: Number,
    example: 15999000,
    minimum: 0,
    nullable: true,
  })
  @IsOptional()
  @IsInt() // BE-01: pul — butun so‘m
  @Max(MAX_MONEY)
  @Min(0)
  oldPrice?: number | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: 'https://cdn.example.com/iphone.jpg',
    description:
      'Asosiy rasm URL (yoki images massivida kamida bitta rasm bo‘lishi shart)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  imageUrl?: string | null;

  @ApiPropertyOptional({
    type: [String],
    example: ['https://cdn.example.com/iphone-1.jpg'],
    description:
      'Mahsulot rasmlari (agar imageUrl bo‘sh bo‘lsa, kamida bitta rasm talab qilinadi)',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(500, {
    each: true,
    message: 'images ichida faqat 500 belgigacha bo‘lgan rasm URL yuboriladi',
  })
  images?: string[];

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    example: { brand: 'Apple', storage: '256 GB' },
  })
  @IsOptional()
  @IsObject()
  attributes?: Record<string, unknown>;

  // BE-07: holat bu yerda berilmaydi — yangi mahsulot PENDING_REVIEW, ACTIVE faqat admin tasdig‘i bilan
}

/** BE-07: faqat admin o‘zgartiradigan maydonlar (ADM-1). */
class AdminProductFlagsDto {
  @ApiPropertyOptional({
    example: true,
    description: 'Offer sotuvchilarga ochiq (sukut: ha)',
  })
  @IsOptional()
  @IsBoolean()
  cpaEnabled?: boolean;

  @ApiPropertyOptional({
    example: false,
    description: 'BAD — «Dori vositasi emas» yozuvi (8-bo‘lim)',
  })
  @IsOptional()
  @IsBoolean()
  isBad?: boolean;

  @ApiPropertyOptional({
    example: '03304001001000000',
    nullable: true,
    type: String,
    description:
      'BE-41: MXIK (IKPU) kodi, 17 raqam — fiskal chek qatori; CPA mahsulotida tasdiqdan oldin majburiy',
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @Matches(/^\d{17}$/, {
    message: 'MXIK kodi 17 raqamdan iborat bo‘lishi kerak',
  })
  mxikCode?: string | null;

  @ApiPropertyOptional({
    example: '1500012',
    nullable: true,
    type: String,
    description:
      'BE-41: qadoq (o‘lchov birligi) kodi, faqat raqam — fiskal chek qatori; CPA mahsulotida tasdiqdan oldin majburiy',
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @Matches(/^\d{1,20}$/, {
    message: 'Qadoq kodi faqat raqamlardan iborat bo‘lishi kerak (1–20 belgi)',
  })
  packageCode?: string | null;
}

export class AdminCreateProductDto extends IntersectionType(
  CreateProductDto,
  AdminProductFlagsDto,
) {
  @ApiProperty({
    example: '15',
    description: 'Optovik ID si (OPT-1: shartnomasi kiritilgan bo‘lishi kerak)',
  })
  @Matches(/^\d+$/, { message: "wholesalerId musbat son bo'lishi kerak" })
  wholesalerId: string;
}

/** `PATCH /admin/products/:id` — admin tahriri (BE-07). */
export class AdminUpdateProductDto extends IntersectionType(
  // `null` qabul qilinmaydi: og‘irlik, o‘lcham yoki bazaviy narxni o‘chirib bo‘lmaydi (BE-07)
  PartialType(CreateProductDto, { skipNullProperties: false }),
  AdminProductFlagsDto,
) {}

/** `POST /admin/products/:id/reject` — rad sababi. */
export class RejectProductDto {
  @ApiProperty({ example: 'Og‘irlik hujjatdagidan farq qiladi' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}

/** `POST /admin/products/:id/hide` — yashirish sababi sellerga yuboriladi. */
export class HideProductDto {
  @ApiProperty({ example: 'Mahsulot rasmi yoki tavsifi qoidalarga zid' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}

export class UpdateProductDto extends PartialType(CreateProductDto, {
  skipNullProperties: false,
}) {}

export class MyProductsQueryDto {
  @ApiPropertyOptional({ example: 'iphone' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  search?: string;

  @ApiPropertyOptional({ enum: ProductStatus })
  @IsOptional()
  @IsEnum(ProductStatus)
  status?: ProductStatus;

  @ApiPropertyOptional({ example: '1' })
  @IsOptional()
  @Matches(/^\d+$/, { message: "categoryId musbat son bo'lishi kerak" })
  categoryId?: string;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;
}

export class ProductDto {
  @ApiProperty({ example: '12' }) id: string;
  @ApiProperty({ example: '5' }) shopId: string;
  @ApiProperty({ example: '42', nullable: true, type: String })
  ownerUserId: string | null;
  @ApiProperty({ type: String, example: '1', nullable: true }) categoryId:
    string | null;
  @ApiProperty({ example: 'iPhone 16 Pro' }) name: string;
  @ApiProperty({ example: 'iphone-16-pro' }) slug: string;
  @ApiProperty({ type: String, example: 'Titanium, 256 GB', nullable: true })
  description: string | null;
  @ApiProperty({ example: 14999000 }) price: number;
  @ApiProperty({ type: Number, example: 15999000, nullable: true }) oldPrice:
    number | null;
  @ApiProperty({ type: String, example: null, nullable: true }) imageUrl:
    string | null;
  @ApiProperty({ type: [String] }) images: string[];
  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    example: { brand: 'Apple' },
  })
  attributes: Record<string, unknown>;
  @ApiProperty({ example: false }) hasVariants: boolean;
  @ApiProperty({ enum: ProductStatus }) status: ProductStatus;
  @ApiProperty({ example: null, nullable: true, type: String })
  moderationNote: string | null;
  @ApiProperty({ example: 140000, nullable: true, type: Number })
  basePrice: number | null;
  @ApiProperty({ example: 65000, nullable: true, type: Number })
  affiliateFee: number | null;
  @ApiProperty({ example: 450, nullable: true, type: Number })
  weightGrams: number | null;
  @ApiProperty({ example: 200, nullable: true, type: Number })
  lengthMm: number | null;
  @ApiProperty({ example: 120, nullable: true, type: Number })
  widthMm: number | null;
  @ApiProperty({ example: 80, nullable: true, type: Number })
  heightMm: number | null;
  @ApiProperty({
    example: 262000,
    nullable: true,
    type: Number,
    description: 'BE-09: tasdiqlangan narx',
  })
  approvedPrice: number | null;
  @ApiProperty({
    example: 'GREEN',
    nullable: true,
    type: String,
    description: 'BE-09: oxirgi narx qarori holati',
  })
  priceStatus: string | null;
  @ApiProperty({
    example: null,
    nullable: true,
    type: Number,
    description: 'BE-09: raqobatchida mijoz jami (NRX-5)',
  })
  marketTotal: number | null;
  @ApiProperty({ example: true }) cpaEnabled: boolean;
  @ApiProperty({ example: false }) isBad: boolean;
  @ApiPropertyOptional({
    example: false,
    description:
      'BE-25: postavkada muddat kuzatiladi (OMB-3) — BAD mahsulot yoki toifa belgisi. Faqat admin ro‘yxati va kartasida',
  })
  expiryTracked?: boolean;
  @ApiPropertyOptional({
    example: false,
    description:
      'BE-25 (TZ 8): toifasi BAD — o‘z `isBad` belgisi bo‘lmasa ham sahifada «Dori vositasi emas». Faqat admin ro‘yxati va kartasida',
  })
  badByCategory?: boolean;
  @ApiProperty({ example: false }) isBlocked: boolean;
  @ApiProperty({
    example: null,
    nullable: true,
    type: String,
    description: 'BE-27: yashirish sababi',
  })
  blockReason: string | null;
  @ApiProperty({
    example: '03304001001000000',
    nullable: true,
    type: String,
    description: 'BE-41: MXIK (IKPU) kodi — fiskal chek qatori',
  })
  mxikCode: string | null;
  @ApiProperty({
    example: '1500012',
    nullable: true,
    type: String,
    description: 'BE-41: qadoq kodi — fiskal chek qatori',
  })
  packageCode: string | null;
  @ApiProperty({ example: 4.75 }) rating: number;
  @ApiProperty({ example: '2026-08-14T10:00:00.000Z' }) createdAt: Date;
  @ApiProperty({ example: '2026-08-14T10:00:00.000Z' }) updatedAt: Date;
}

export class MyProductsPageDto {
  @ApiProperty({ type: [ProductDto] }) items: ProductDto[];
  @ApiProperty({ example: 25 }) total: number;
  @ApiProperty({ example: 1 }) page: number;
  @ApiProperty({ example: 20 }) limit: number;
  @ApiProperty({ example: 2 }) totalPages: number;
}

/**
 * BE-27: `GET /admin/moderation/summary` — moderatsiya tablari va mahsulot yorliqlari soni (FE-12 taklifi, 2-bo‘lim).
 */
export class ModerationSummaryDto {
  @ApiProperty({
    example: 1,
    description: 'Tasdiq kutayotgan mahsulotlar (PENDING_REVIEW)',
  })
  productsPending: number;

  @ApiProperty({
    example: 3,
    description:
      'Narx qarori kutayotgan CPA mahsulotlari: tasdiqlangan narx yo‘q yoki amalda emas (BE-09)',
  })
  pricesPending: number;

  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'number' },
    example: {
      ALL: 7,
      PENDING_REVIEW: 1,
      ACTIVE: 4,
      REJECTED: 1,
      BLOCKED: 0,
      DRAFT: 1,
    },
    description:
      'Holat bo‘yicha (o‘chirilmaganlar); BLOCKED — yashirilgan, ACTIVE — sotuvda va yashirilmagan',
  })
  byStatus: Record<string, number>;

  @ApiProperty({
    example: 1,
    nullable: true,
    type: Number,
    description:
      'Sotuvdagi CPA mahsulotlari, qoldig‘i 0; null — ombor javob bermadi',
  })
  outOfStock: number | null;

  @ApiProperty({
    example: 0,
    nullable: true,
    type: Number,
    description:
      'Sotuvdan chiqqan, omborda turgan partiyalar (muddat − 60 kun o‘tgan, BE-17 OMB-3) [taklif]; null — ombor javob bermadi',
  })
  expirySoon: number | null;
}

export const CATALOG_MODERATION_RPC = {
  SUMMARY: 'catalog.moderation.summary',
  /** BE-25 (FE-13): narx qarori kutayotgan mahsulotlar ro‘yxati (`pricesPending` bilan bir xil qoida). */
  PRICES: 'catalog.moderation.prices',
} as const;

/** BE-25 (FE-13): narx navbati qatori. */
export class PriceQueueItemDto {
  @ApiProperty({ example: '511' }) productId: string;
  @ApiProperty({ example: 'Simsiz quloqchinlar' }) name: string;
  @ApiProperty({ example: 'Namuna Savdo MChJ', nullable: true, type: String })
  shopName: string | null;
  @ApiProperty({ example: 140000, nullable: true, type: Number })
  basePrice: number | null;
  @ApiProperty({
    example: 262000,
    nullable: true,
    type: Number,
    description:
      'Tavsiya narx (joriy rejimda). Bazaviy narx, og‘irlik yoki sozlama yo‘q — hisoblanmaydi, null',
  })
  recommended: number | null;
  @ApiProperty({ enum: DeliveryDisplayMode, nullable: true })
  deliveryMode: DeliveryDisplayMode | null;
  @ApiProperty({
    example: '2027-01-06T05:05:00.000Z',
    description:
      'Mahsulot oxirgi o‘zgargan vaqt [taklif]; tartib — eskisi oldin',
  })
  queuedAt: string;
}

export class PriceQueueDto {
  @ApiProperty({ type: [PriceQueueItemDto] }) items: PriceQueueItemDto[];
  @ApiProperty({ example: 1 }) total: number;
}
