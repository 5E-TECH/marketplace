import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
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
  MinLength,
  NotEquals,
} from 'class-validator';

export class CreateWarehouseDto {
  @ApiProperty({
    example: 'Asosiy ombor',
    description: 'Ombor nomi',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name: string;

  @ApiPropertyOptional({
    example: '12',
    nullable: true,
    description: 'Viloyat yoki hudud IDsi',
  })
  @IsOptional()
  @IsString()
  regionId?: string | null;

  @ApiPropertyOptional({
    example: '140',
    nullable: true,
    description: 'Tuman IDsi',
  })
  @IsOptional()
  @IsString()
  districtId?: string | null;

  @ApiPropertyOptional({
    example: 'Toshkent shahri, Chilonzor tumani',
    nullable: true,
    description: 'Omborning to‘liq manzili',
  })
  @IsOptional()
  @IsString()
  address?: string | null;

  @ApiPropertyOptional({
    example: true,
    default: false,
    description: 'Ombor asosiy ombor ekanligini bildiradi',
  })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class UpdateWarehouseDto extends PartialType(CreateWarehouseDto) {}

export class WarehouseDto {
  @ApiProperty({ example: '3' })
  id: string;

  @ApiProperty({ example: '15' })
  ownerId: string;

  @ApiProperty({ example: 'Asosiy ombor' })
  name: string;

  @ApiProperty({ example: '12', nullable: true })
  regionId: string | null;

  @ApiProperty({ example: '140', nullable: true })
  districtId: string | null;

  @ApiProperty({
    example: 'Toshkent shahri, Chilonzor tumani',
    nullable: true,
  })
  address: string | null;

  @ApiProperty({ example: true })
  isDefault: boolean;

  @ApiProperty({ example: true })
  isActive: boolean;

  @ApiProperty({ example: '2026-07-29T10:00:00.000Z' })
  createdAt: Date;

  @ApiProperty({ example: '2026-07-29T10:00:00.000Z' })
  updatedAt: Date;
}

export class StockQueryDto {
  @ApiPropertyOptional({ example: '3' })
  @IsOptional()
  @Matches(/^\d+$/, { message: "warehouseId musbat son bo'lishi kerak" })
  warehouseId?: string;

  @ApiPropertyOptional({ example: '88' })
  @IsOptional()
  @Matches(/^\d+$/, { message: "variantId musbat son bo'lishi kerak" })
  variantId?: string;

  @ApiPropertyOptional({ example: '12' })
  @IsOptional()
  @Matches(/^\d+$/, { message: "productId musbat son bo'lishi kerak" })
  productId?: string;

  @ApiPropertyOptional({ example: 'iphone' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  search?: string;

  @ApiPropertyOptional({ example: false, default: false })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  lowOnly = false;

  @ApiPropertyOptional({ example: 1, default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({
    example: 20,
    default: 20,
    minimum: 1,
    maximum: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}

export class StockItemDto {
  @ApiProperty({ example: '88' })
  variantId: string;

  @ApiProperty({ example: 'iPhone 16 Pro' })
  productName: string;

  @ApiProperty({ example: 'Qora / 256 GB', nullable: true })
  variantName: string | null;

  @ApiProperty({ example: 'IPHONE-16-BLACK-256' })
  sku: string;

  @ApiProperty({ example: '3' })
  warehouseId: string;

  @ApiProperty({ example: 'Asosiy ombor' })
  warehouseName: string;

  @ApiProperty({ example: 15 })
  onHand: number;

  @ApiProperty({ example: 3 })
  reserved: number;

  @ApiProperty({ example: 12 })
  available: number;

  @ApiProperty({ example: 5 })
  lowStockThreshold: number;
}

export class StockPageDto {
  @ApiProperty({ type: [StockItemDto] })
  items: StockItemDto[];

  @ApiProperty({ example: 25 })
  total: number;

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 20 })
  limit: number;

  @ApiProperty({ example: 2 })
  totalPages: number;
}

export class StockInboundDto {
  @ApiProperty({ example: '88' })
  @Matches(/^[1-9]\d*$/, { message: "variantId musbat son bo'lishi kerak" })
  variantId: string;

  @ApiProperty({ example: '3' })
  @Matches(/^[1-9]\d*$/, { message: "warehouseId musbat son bo'lishi kerak" })
  warehouseId: string;

  @ApiProperty({ example: 50, minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity: number;

  @ApiProperty({ example: 'Yangi partiya' })
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  reason: string;

  @ApiPropertyOptional({ example: 'po-2026-07-21-001', maxLength: 230 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(230)
  idempotencyKey?: string;
}

export class StockAdjustDto {
  @ApiProperty({ example: '88' })
  @Matches(/^[1-9]\d*$/, { message: "variantId musbat son bo'lishi kerak" })
  variantId: string;

  @ApiProperty({ example: '3' })
  @Matches(/^[1-9]\d*$/, { message: "warehouseId musbat son bo'lishi kerak" })
  warehouseId: string;

  @ApiProperty({ example: -5, description: 'Noldan farqli signed miqdor' })
  @Type(() => Number)
  @IsInt()
  @NotEquals(0, { message: "delta noldan farqli bo'lishi kerak" })
  delta: number;

  @ApiProperty({ example: 'Yaroqsiz tovar' })
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  reason: string;

  @ApiPropertyOptional({ example: 'adj-2026-07-21-001', maxLength: 230 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(230)
  idempotencyKey?: string;
}

export class StockMutationResultDto {
  @ApiProperty({ example: '88' })
  variantId: string;

  @ApiProperty({ example: '3' })
  warehouseId: string;

  @ApiProperty({ example: 45 })
  onHand: number;

  @ApiProperty({ example: 3 })
  reserved: number;

  @ApiProperty({ example: 42 })
  available: number;
}
