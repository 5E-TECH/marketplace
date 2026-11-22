import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { MAX_MONEY } from '../database/money.transformer';
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
  @ApiProperty({ example: 'Shovqinni pasaytiradi', nullable: true })
  subtitle: string | null;
  @ApiProperty({ example: 'Batareya 30 soat…', nullable: true })
  description: string | null;
  @ApiProperty({ example: ['https://elchimarket.uz/media/p/12-1.webp'] })
  images: string[];
  @ApiProperty({ example: null, nullable: true }) videoUrl: string | null;
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
  sort = 'createdAt:desc';

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}

export class StorefrontProductsPageDto {
  @ApiProperty({ type: [StorefrontProductDto] })
  items: StorefrontProductDto[];
  @ApiProperty({ example: 25 }) total: number;
  @ApiProperty({ example: 1 }) page: number;
  @ApiProperty({ example: 20 }) limit: number;
  @ApiProperty({ example: 2 }) totalPages: number;
}
