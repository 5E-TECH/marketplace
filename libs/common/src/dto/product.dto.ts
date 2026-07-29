import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Matches,
  Min,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { ProductStatus } from '../enums';

export class CreateProductDto {
  @ApiProperty({ example: 'iPhone 16 Pro' })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name: string;

  @ApiPropertyOptional({ example: '1', nullable: true })
  @IsOptional()
  @Matches(/^\d+$/, { message: "categoryId musbat son bo'lishi kerak" })
  categoryId?: string | null;

  @ApiPropertyOptional({ example: 'Titanium, 256 GB' })
  @IsOptional()
  @IsString()
  description?: string | null;

  @ApiProperty({ example: 14999000, minimum: 0 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  price: number;

  @ApiPropertyOptional({ example: 15999000, minimum: 0, nullable: true })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  oldPrice?: number | null;

  @ApiPropertyOptional({ example: 'https://cdn.example.com/iphone.jpg' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  imageUrl?: string | null;

  @ApiPropertyOptional({
    type: [String],
    example: ['https://cdn.example.com/iphone-1.jpg'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  images?: string[];

  @ApiPropertyOptional({
    example: { brand: 'Apple', storage: '256 GB' },
  })
  @IsOptional()
  @IsObject()
  attributes?: Record<string, unknown>;

  @ApiPropertyOptional({ enum: ProductStatus, default: ProductStatus.DRAFT })
  @IsOptional()
  @IsEnum(ProductStatus)
  status?: ProductStatus;
}

export class UpdateProductDto extends PartialType(CreateProductDto) {}

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
  page = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}

export class ProductDto {
  @ApiProperty({ example: '12' }) id: string;
  @ApiProperty({ example: '5' }) shopId: string;
  @ApiProperty({ example: '42' }) ownerUserId: string;
  @ApiProperty({ example: '1', nullable: true }) categoryId: string | null;
  @ApiProperty({ example: 'iPhone 16 Pro' }) name: string;
  @ApiProperty({ example: 'iphone-16-pro' }) slug: string;
  @ApiProperty({ example: 'Titanium, 256 GB', nullable: true })
  description: string | null;
  @ApiProperty({ example: 14999000 }) price: number;
  @ApiProperty({ example: 15999000, nullable: true }) oldPrice: number | null;
  @ApiProperty({ example: null, nullable: true }) imageUrl: string | null;
  @ApiProperty({ type: [String] }) images: string[];
  @ApiProperty({ example: { brand: 'Apple' } })
  attributes: Record<string, unknown>;
  @ApiProperty({ example: false }) hasVariants: boolean;
  @ApiProperty({ enum: ProductStatus }) status: ProductStatus;
}

export class MyProductsPageDto {
  @ApiProperty({ type: [ProductDto] }) items: ProductDto[];
  @ApiProperty({ example: 25 }) total: number;
  @ApiProperty({ example: 1 }) page: number;
  @ApiProperty({ example: 20 }) limit: number;
  @ApiProperty({ example: 2 }) totalPages: number;
}
