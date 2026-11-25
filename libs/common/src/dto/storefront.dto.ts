import { Transform, Type } from 'class-transformer';
import {
  Allow,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { MAX_MONEY } from '../database/money.transformer';
import { CheckoutDeliveryDestination } from './cart.dto';
import { PHONE_UZ_PATTERN, trimLeadText } from './lead.dto';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** BE-34: sayt mahsulotining kategoriyasi. */
export class StorefrontCategoryRefDto {
  @ApiProperty({ example: '7' }) id: string;
  @ApiProperty({ example: 'Quloqchinlar' }) name: string;
}

export class StorefrontAttributeDto {
  @ApiProperty({ example: 'Aloqa' }) name: string;
  @ApiProperty({ example: 'Bluetooth 5.3' }) value: string;
}

/**
 * BE-34: asosiy saytdagi mahsulot (ochiq). Narx — tasdiqlangan narx (TZ SAYT-2). Bazaviy narx, sotuvchi haqi, optovik
 * STIR va rekvizitlari, qoldiq soni javobda yo‘q (C6.10, TC3).
 */
export class StorefrontProductDto {
  @ApiProperty({ example: '12' }) id: string;
  @ApiProperty({ example: 'Simsiz quloqchin X1' }) name: string;
  @ApiProperty({
    type: String,
    example: 'Shovqinni pasaytiradi',
    nullable: true,
  })
  subtitle: string | null;
  @ApiProperty({ type: String, example: 'Batareya 30 soat…', nullable: true })
  description: string | null;
  @ApiProperty({ example: ['https://elchimarket.uz/media/p/12-1.webp'] })
  images: string[];
  @ApiProperty({ type: String, example: null, nullable: true }) videoUrl:
    string | null;
  @ApiProperty({ type: StorefrontCategoryRefDto, nullable: true })
  category: StorefrontCategoryRefDto | null;
  @ApiProperty({ type: [StorefrontAttributeDto] })
  attributes: StorefrontAttributeDto[];
  @ApiProperty({
    example: false,
    description: 'Biologik faol qo‘shimcha — «Dori vositasi emas» yozuvi',
  })
  isBad: boolean;
  @ApiProperty({ example: 249000, description: 'Tasdiqlangan narx, so‘m' })
  price: number;
  @ApiProperty({ example: 25000, description: 'Markazgacha yetkazish, so‘m' })
  deliveryToCenter: number;
  @ApiProperty({ example: 35000, description: 'Eshikkacha yetkazish, so‘m' })
  deliveryToAddress: number;
  @ApiProperty({
    type: Boolean,
    example: true,
    nullable: true,
    description: 'Omborda bor; null — ombor javob bermadi (noma’lum)',
  })
  inStock: boolean | null;
}

export class StorefrontProductDetailsDto extends StorefrontProductDto {
  @ApiProperty({
    type: [StorefrontProductDto],
    description: '«Shu bo‘limdan» — shu kategoriyadagi boshqa mahsulotlar',
  })
  related: StorefrontProductDto[];
}

export class StorefrontProductsQueryDto {
  @ApiPropertyOptional({ example: 'iphone' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  search?: string;

  @ApiPropertyOptional({ example: '7' })
  @IsOptional()
  @Matches(/^\d+$/, { message: "categoryId musbat son bo'lishi kerak" })
  categoryId?: string;

  @ApiPropertyOptional({ example: 100000, minimum: 0 })
  @IsOptional()
  // BE-01: narx butun so‘m; URL dagi kasr filtr chegarasi butunga
  // keltiriladi (min — yuqoriga, max — pastga), natija o‘zgarmaydi.
  @Transform(({ value }) =>
    value === undefined || value === null ? value : Math.ceil(Number(value)),
  )
  @IsInt()
  @Min(0)
  @Max(MAX_MONEY)
  minPrice?: number;

  @ApiPropertyOptional({ example: 15000000, minimum: 0 })
  @IsOptional()
  // BE-01: narx butun so‘m; URL dagi kasr filtr chegarasi butunga
  // keltiriladi (min — yuqoriga, max — pastga), natija o‘zgarmaydi.
  @Transform(({ value }) =>
    value === undefined || value === null ? value : Math.floor(Number(value)),
  )
  @IsInt()
  @Min(0)
  @Max(MAX_MONEY)
  maxPrice?: number;

  @ApiPropertyOptional({
    example: true,
    description: 'Faqat omborda bor mahsulotlar',
  })
  @IsOptional()
  @Transform(({ value }) =>
    value === 'true' || value === true
      ? true
      : value === 'false' || value === false
        ? false
        : value,
  )
  @IsBoolean()
  inStock?: boolean;

  @ApiPropertyOptional({
    default: 'createdAt:desc',
    enum: [
      'createdAt:asc',
      'createdAt:desc',
      'price:asc',
      'price:desc',
      'name:asc',
      'name:desc',
    ],
  })
  @IsOptional()
  @Matches(/^(createdAt|price|name):(asc|desc)$/)
  sort: string = 'createdAt:desc';

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

export class StorefrontProductsPageDto {
  @ApiProperty({ type: [StorefrontProductDto] })
  items: StorefrontProductDto[];
  @ApiProperty({ example: 25 }) total: number;
  @ApiProperty({ example: 1 }) page: number;
  @ApiProperty({ example: 20 }) limit: number;
  @ApiProperty({ example: 2 }) totalPages: number;
}

// ─── Saytdan buyurtma (BE-34) ───────────────────────────────────────────────

/** Tasdiqlash usuli (ega qarori 2026-11-10): operator qo‘ng‘iroq qiladi yoki mijoz SMS havola bilan tasdiqlaydi. */
export enum SiteConfirmMode {
  CALL = 'CALL',
  SMS = 'SMS',
}

/** Bitta buyurtmadagi tovar qatorlari chegarasi (savat qatorlari) [taklif]. */
export const SITE_ORDER_MAX_LINES = 50;

export const SITE_ORDER_RPC = {
  /** gateway → lead-service: savatdan lid (source SITE). */
  CREATE: 'lead.site.create',
  /** gateway → lead-service: SMS havola bosildi. */
  CONFIRM: 'lead.site.confirm',
} as const;

/** Savat qatori lid uchun: mahsulot va soni (narx lead-service da katalogdan — tasdiqlangan narx). */
export interface SiteOrderLine {
  productId: string;
  quantity: number;
}

/** POST /storefront/orders — mehmon buyurtmasi: hamma maydon majburiy (ega qarori 2026-11-10), manzil BE-38 qoidalari. */
export class SiteOrderDto {
  @ApiProperty({ example: 'Aziza' })
  @Transform(trimLeadText)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @ApiProperty({ example: '+998901234567' })
  @Matches(PHONE_UZ_PATTERN, {
    message: "phone +998XXXXXXXXX formatida bo'lishi kerak",
  })
  phone: string;

  @ApiProperty({ example: '1726', description: 'Viloyat SOATO kodi' })
  @Transform(trimLeadText)
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  regionSoato: string;

  @ApiProperty({
    example: '1726266',
    description: 'Tuman yoki shahar SOATO kodi',
  })
  @Transform(trimLeadText)
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  districtSoato: string;

  @ApiProperty({
    example: 'Turkiston ko‘chasi, 27-uy',
    description:
      'Ko‘cha, uy; faqat bo‘shliq — bo‘sh hisoblanadi (TC2: 400, maydon nomi bilan)',
  })
  @Transform(trimLeadText)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  addressLine: string;

  @ApiProperty({
    enum: CheckoutDeliveryDestination,
    example: CheckoutDeliveryDestination.ADDRESS,
  })
  @IsEnum(CheckoutDeliveryDestination)
  whereDeliver: CheckoutDeliveryDestination;

  @ApiProperty({
    enum: SiteConfirmMode,
    example: SiteConfirmMode.CALL,
    description:
      'CALL — operator qo‘ng‘iroq qiladi; SMS — havola bosilgach buyurtma operatorsiz. Qora ro‘yxat yoki dublikat ' +
      'bo‘lsa server CALL qiladi',
  })
  @IsEnum(SiteConfirmMode)
  confirmMode: SiteConfirmMode;

  @ApiProperty({
    example: '2026-11-16',
    description: 'Oferta va maxfiylik matni versiyasi',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  consentVersion: string;

  @ApiPropertyOptional({
    type: String,
    description:
      'Yashirin maydon (bot himoyasi): to‘ldirilsa lid yozilmaydi, javob baribir 201',
  })
  @IsOptional()
  @Allow()
  website?: unknown;
}

export class SiteOrderCreatedDto {
  @ApiProperty({ example: '7001' }) leadId: string;
  @ApiProperty({
    enum: SiteConfirmMode,
    description:
      'Haqiqiy usul: SMS so‘ralgan bo‘lsa ham qora ro‘yxat yoki dublikatda — CALL',
  })
  confirmMode: SiteConfirmMode;
}

export class SiteOrderConfirmDto {
  @ApiProperty({
    example: 'q3Jf…',
    description: 'SMS havoladagi bir martalik kod',
  })
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{43}$/, { message: 'token noto‘g‘ri' })
  token: string;
}

export class SiteOrderConfirmedDto {
  @ApiProperty({ example: 'CONFIRMED' }) status: 'CONFIRMED';
}

// ─── Mehmon savati (BE-34) ──────────────────────────────────────────────────

export class StorefrontCartItemDto {
  @ApiProperty({ example: '12' })
  @Matches(/^[1-9]\d{0,18}$/, {
    message: 'productId musbat son bo‘lishi kerak',
  })
  productId: string;

  @ApiPropertyOptional({ example: 1, default: 1, minimum: 1, maximum: 1000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  // BE-18: bitta tovar qatori 1 000 donagacha
  @Max(1000)
  quantity: number = 1;
}

export class UpdateStorefrontCartItemDto {
  @ApiProperty({ example: 2, minimum: 1, maximum: 1000 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  quantity: number;
}

export class StorefrontCartLineDto {
  @ApiProperty({ example: '31' }) id: string;
  @ApiProperty({ example: '12' }) productId: string;
  @ApiProperty({ example: 'Simsiz quloqchin X1' }) productName: string;
  @ApiProperty({ type: String, example: null, nullable: true }) imageUrl:
    string | null;
  @ApiProperty({ example: 1 }) quantity: number;
  @ApiProperty({
    example: 249000,
    description: 'Savatga qo‘shilgandagi tasdiqlangan narx',
  })
  unitPrice: number;
  @ApiProperty({ example: 249000 }) lineTotal: number;
}

/** Mehmon savati (ochiq): ichki maydonlarsiz — optovik, variant va egasi yo‘q. */
export class StorefrontCartDto {
  @ApiProperty({ type: [StorefrontCartLineDto] })
  items: StorefrontCartLineDto[];
  @ApiProperty({ example: 249000 }) totalAmount: number;
  @ApiProperty({ example: 1 }) totalQuantity: number;
}
