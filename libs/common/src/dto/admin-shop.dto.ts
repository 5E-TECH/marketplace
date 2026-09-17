import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ShopStatus } from '../enums';
import { ProductStatus } from '../enums';

/** `GET /admin/shops` — filtr + sahifalash. */
export class AdminShopsQueryDto {
  @ApiPropertyOptional({ enum: ShopStatus, example: ShopStatus.PENDING })
  @IsOptional()
  @IsEnum(ShopStatus)
  status?: ShopStatus;

  @ApiPropertyOptional({ example: 'Ali Market' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  search?: string;

  @ApiPropertyOptional({ example: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ example: 20, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}

/** `POST /admin/shops/:id/reject` — ixtiyoriy sabab. */
export class RejectShopDto {
  @ApiPropertyOptional({ example: 'Hujjatlar to‘liq emas' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

/** `POST /admin/shops/:id/feature` — bosh sahifada ko‘rsatish/yashirish. */
export class FeatureShopDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  featured: boolean;
}

/** `PATCH /admin/shops/:id/tariffs` — Elchi market tariflari. */
export class UpdateShopTariffsDto {
  @ApiProperty({ example: 25000, minimum: 1 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  tariffHome: number;

  @ApiProperty({ example: 15000, minimum: 1 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  tariffCenter: number;
}

export class AdminShopDetailStatsDto {
  @ApiProperty({ example: 12 }) products: number;
  @ApiProperty({ example: 28 }) orders: number;
  @ApiProperty({ example: 2 }) warehouses: number;
}

export class AdminShopDetailDto {
  @ApiProperty({ example: '15' }) id: string;
  @ApiProperty({ example: '42' }) ownerUserId: string;
  @ApiProperty({ example: 'Ali Market' }) name: string;
  @ApiProperty({ enum: ShopStatus }) status: ShopStatus;
  @ApiProperty({ example: 25000 }) tariffHome: number;
  @ApiProperty({ example: 15000 }) tariffCenter: number;
  @ApiProperty({ type: AdminShopDetailStatsDto })
  stats: AdminShopDetailStatsDto;
}

export class AdminProductsQueryDto {
  @ApiPropertyOptional({ enum: ProductStatus })
  @IsOptional()
  @IsEnum(ProductStatus)
  status?: ProductStatus;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @Transform(({ value }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  @IsBoolean()
  blocked?: boolean;

  @ApiPropertyOptional({ example: '15' })
  @IsOptional()
  @IsString()
  shopId?: string;

  @ApiPropertyOptional({ example: 'telefon' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  search?: string;

  @ApiPropertyOptional({ example: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ example: 20, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}
