import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ShopStatus } from '../enums';
import { ProductStatus } from '../enums';
import { IsLeadBigintId } from './lead.dto';

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
  page: number = 1;

  @ApiPropertyOptional({ example: 20, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;
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

export class AdminShopDetailStatsDto {
  @ApiProperty({ example: 12 }) products: number;
  @ApiProperty({ example: 28 }) orders: number;
  @ApiProperty({ example: 2 }) warehouses: number;
}

export class AdminShopDetailDto {
  @ApiProperty({ example: '15' }) id: string;
  @ApiProperty({ example: '42', nullable: true, type: String })
  ownerUserId: string | null;
  @ApiProperty({ example: 'Ali Market' }) name: string;
  @ApiProperty({ enum: ShopStatus }) status: ShopStatus;
  @ApiProperty({ type: AdminShopDetailStatsDto })
  stats: AdminShopDetailStatsDto;
}

/** `'true'`/`'false'` (query) → boolean; boshqasi o‘zgarmaydi (validator rad etadi). */
const toBool = ({ value }: { value: unknown }) => {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
};

/** BE-25 (FE-12): «Diqqat» filtri — moderatsiya hisoblagichlari (`outOfStock`, `expirySoon`) bilan bir qoida. */
export enum AdminProductAttention {
  OUT_OF_STOCK = 'OUT_OF_STOCK',
  EXPIRY_SOON = 'EXPIRY_SOON',
}

export class AdminProductsQueryDto {
  @ApiPropertyOptional({ enum: ProductStatus })
  @IsOptional()
  @IsEnum(ProductStatus)
  status?: ProductStatus;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  blocked?: boolean;

  @ApiPropertyOptional({ example: '15' })
  @IsOptional()
  @IsString()
  shopId?: string;

  @ApiPropertyOptional({
    example: 'telefon',
    description: 'Nomi yoki slug bo‘yicha (BE-25, FE-12)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  search?: string;

  @ApiPropertyOptional({
    example: '3',
    description:
      'Aynan shu kategoriya (ichki kategoriyalarsiz) — BE-25 (FE-12)',
  })
  @IsOptional()
  @IsLeadBigintId('categoryId')
  categoryId?: string;

  @ApiPropertyOptional({
    example: true,
    description:
      'Kanal (BE-25, FE-12): true — sotuvchilar va sayt (CPA), false — faqat sayt',
  })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  cpaEnabled?: boolean;

  @ApiPropertyOptional({
    enum: AdminProductAttention,
    description:
      'BE-25 (FE-12): OUT_OF_STOCK — sotuvdagi CPA mahsulot, bo‘sh qoldiq 0 (moderatsiya `outOfStock`); ' +
      'EXPIRY_SOON — sotuvdan chiqqan partiyasi omborda turgan mahsulot (`expirySoon`). Ombor javob bermasa — 503.',
  })
  @IsOptional()
  @IsEnum(AdminProductAttention)
  attention?: AdminProductAttention;

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
