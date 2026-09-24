import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

/** Jami bannerlar chegarasi — tartiblash so'rovi ham shuncha elementni oladi. */
export const MAX_BANNERS = 100;
/** Bosh sahifada bir vaqtda ko'rsatiladigan bannerlar soni. */
export const STOREFRONT_BANNER_LIMIT = 12;
/** `sort_order INTEGER` ustunining yuqori chegarasi. */
export const BANNER_SORT_ORDER_MAX = 2147483647;

/**
 * Banner havolasi: sayt ichidagi yo'l (`/katalog/telefon`) yoki to'liq
 * http(s) manzil. Rad etiladi:
 *   • `//host` va `/\host` — brauzer ularni boshqa domenga o'tish deb o'qiydi;
 *   • teskari slash va bo'sh joy;
 *   • `/api/...` va `/storefront/...` — storefront'da ular JSON qaytaradi,
 *     xaridor sahifa o'rniga xom ma'lumotni ko'radi;
 *   • `katalog/telefon`, `elchimarket.uz/aksiya` kabi sxemasiz qiymatlar —
 *     storefront ularni bosiladigan havolaga aylantira olmaydi.
 * Storefront `safeBannerHref` va admin formasi xuddi shu qoidani qo'llaydi.
 */
export const BANNER_LINK_PATTERN =
  /^(?:\/(?![/\\])(?!(?:api|storefront)(?:[/?#]|$))[^\s\\]*|https?:\/\/[^\s\\/?#]+[^\s\\]*)$/i;
const BANNER_LINK_MESSAGE =
  "Havola '/' bilan boshlanuvchi sayt yo'li (masalan /katalog/telefon) yoki to'liq https:// manzil bo'lishi kerak";

/** Bo'sh qiymat (`''`, `null`) havolasiz banner degani — tekshirilmaydi. */
const hasLink = (_: unknown, value: unknown) =>
  value !== undefined && value !== null && value !== '';
/** Qiymat yuborilgan bo'lsa (hatto `null` bo'lsa ham) tekshiriladi. */
const isProvided = (_: unknown, value: unknown) => value !== undefined;

/** C6.9 — bosh sahifa reklama bannerlari. */
export class CreateBannerDto {
  @ApiProperty({
    example: '50% chegirma',
    description: 'Storefront’da banner rasmi ustida yoziladi.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  title: string;

  @ApiProperty({
    example:
      'https://api.elchimarket.uz/media/marketplace-media/banners/1727000000000-uuid.jpg',
    description:
      '`POST /admin/content/banners/image` qaytargan manzil. Faqat platforma media ' +
      'omboridagi rasm qabul qilinadi — boshqa hostdagi rasm storefront’da chiqmaydi.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  imageUrl: string;

  @ApiPropertyOptional({
    type: String,
    example: '/katalog/telefon',
    nullable: true,
    description:
      "Bannerga bosilganda ochiladigan sahifa: '/' bilan boshlanuvchi yo'l yoki https:// manzil. Bo'sh — banner bosilmaydi.",
  })
  @ValidateIf(hasLink)
  @IsString()
  @MaxLength(1000)
  @Matches(BANNER_LINK_PATTERN, { message: BANNER_LINK_MESSAGE })
  linkUrl?: string | null;

  @ApiPropertyOptional({
    example: 10,
    default: 0,
    minimum: 0,
    maximum: BANNER_SORT_ORDER_MAX,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(BANNER_SORT_ORDER_MAX)
  sortOrder?: number;

  @ApiPropertyOptional({ example: true, default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    type: String,
    example: '2026-09-25T00:00:00.000Z',
    nullable: true,
    description: 'Shu vaqtgacha storefront’da ko‘rinmaydi; null — darhol.',
  })
  @IsOptional()
  @IsDateString()
  startsAt?: string | null;

  @ApiPropertyOptional({
    type: String,
    example: '2026-10-01T00:00:00.000Z',
    nullable: true,
    description: 'Shu vaqtdan keyin o‘zi yo‘qoladi; null — muddatsiz.',
  })
  @IsOptional()
  @IsDateString()
  endsAt?: string | null;
}

/**
 * `PartialType` ishlatilmaydi: u har maydonga `@IsOptional()` qo'yadi, bu esa
 * `null` ni ham tekshiruvsiz o'tkazib yuboradi — `{"title": null}` servisda
 * TypeError, `{"sortOrder": null}` esa NOT NULL xatosi bilan 500 berardi.
 * Bu yerda majburiy ustunlar faqat yuborilmaganda o'tkazib yuboriladi,
 * `null` esa 400 bilan rad etiladi.
 */
export class UpdateBannerDto {
  @ApiPropertyOptional({ example: '50% chegirma' })
  @ValidateIf(isProvided)
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  title?: string;

  @ApiPropertyOptional({
    example:
      'https://api.elchimarket.uz/media/marketplace-media/banners/1727000000000-uuid.jpg',
  })
  @ValidateIf(isProvided)
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  imageUrl?: string;

  @ApiPropertyOptional({
    type: String,
    example: '/katalog/telefon',
    nullable: true,
    description: "Bo'sh qiymat yoki null havolani olib tashlaydi.",
  })
  @ValidateIf(hasLink)
  @IsString()
  @MaxLength(1000)
  @Matches(BANNER_LINK_PATTERN, { message: BANNER_LINK_MESSAGE })
  linkUrl?: string | null;

  @ApiPropertyOptional({
    example: 10,
    minimum: 0,
    maximum: BANNER_SORT_ORDER_MAX,
  })
  @ValidateIf(isProvided)
  @IsInt()
  @Min(0)
  @Max(BANNER_SORT_ORDER_MAX)
  sortOrder?: number;

  @ApiPropertyOptional({ example: true })
  @ValidateIf(isProvided)
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    type: String,
    example: '2026-09-25T00:00:00.000Z',
    nullable: true,
  })
  @IsOptional()
  @IsDateString()
  startsAt?: string | null;

  @ApiPropertyOptional({
    type: String,
    example: '2026-10-01T00:00:00.000Z',
    nullable: true,
  })
  @IsOptional()
  @IsDateString()
  endsAt?: string | null;
}

export class ReorderBannerItemDto {
  @ApiProperty({ example: '3' })
  @Matches(/^[1-9]\d{0,18}$/, { message: "id musbat son bo'lishi kerak" })
  id: string;

  @ApiProperty({ example: 0, minimum: 0, maximum: BANNER_SORT_ORDER_MAX })
  @IsInt()
  @Min(0)
  @Max(BANNER_SORT_ORDER_MAX)
  sortOrder: number;
}

export class ReorderBannersDto {
  @ApiProperty({
    type: [ReorderBannerItemDto],
    minItems: 1,
    maxItems: MAX_BANNERS,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_BANNERS)
  @ValidateNested({ each: true })
  @Type(() => ReorderBannerItemDto)
  items: ReorderBannerItemDto[];
}

/** Storefront uchun — faqat ko‘rsatishga kerak bo‘lgan maydonlar. */
export class StorefrontBannerDto {
  @ApiProperty({ example: '3' }) id: string;
  @ApiProperty({ example: '50% chegirma' }) title: string;
  @ApiProperty({
    example:
      'https://api.elchimarket.uz/media/marketplace-media/banners/1727000000000-uuid.jpg',
  })
  imageUrl: string;
  @ApiProperty({ type: String, example: '/katalog/telefon', nullable: true })
  linkUrl: string | null;
  @ApiProperty({ example: 10 }) sortOrder: number;
}

/** Admin ro‘yxati — jadval holati va muddati bilan. */
export class BannerDto extends StorefrontBannerDto {
  @ApiProperty({ example: true }) isActive: boolean;

  @ApiProperty({ type: String, example: null, nullable: true })
  startsAt: Date | string | null;

  @ApiProperty({ type: String, example: null, nullable: true })
  endsAt: Date | string | null;

  @ApiProperty({
    example: true,
    description:
      'Shu daqiqada storefront’da ko‘rinayotgani — `isActive` va muddat birga.',
  })
  isVisible: boolean;

  @ApiProperty({ type: String, example: '2026-09-22T10:00:00.000Z' })
  createdAt: Date | string;

  @ApiProperty({ type: String, example: '2026-09-22T10:00:00.000Z' })
  updatedAt: Date | string;
}

export class DeleteBannerResultDto {
  @ApiProperty({ example: '3' }) id: string;
  @ApiProperty({ example: true }) deleted: boolean;
}
