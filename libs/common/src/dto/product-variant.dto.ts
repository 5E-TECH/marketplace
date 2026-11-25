import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { MAX_MONEY } from '../database/money.transformer';

export class CreateProductVariantDto {
  @ApiProperty({ example: 'IPHONE-16-BLACK-256' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  sku: string;

  @ApiPropertyOptional({ type: String, example: 'Qora-256 Gb', nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string | null;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    example: { color: 'Qora', storage: '256 Gb' },
  })
  @IsOptional()
  @IsObject()
  attributes?: Record<string, unknown>;

  @ApiPropertyOptional({
    type: Number,
    example: 16000000,
    minimum: 0,
    nullable: true,
  })
  @IsOptional()
  @IsInt() // BE-01: pul — butun so‘m
  @Max(MAX_MONEY)
  @Min(0)
  price?: number | null;

  @ApiPropertyOptional({
    type: Number,
    example: 17000000,
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
    example: '4780012345678',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  barcode?: string | null;

  @ApiPropertyOptional({
    type: String,
    example: 'https://cdn.example.com/products/iphone-black.jpg',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  imageUrl?: string | null;

  @ApiPropertyOptional({ example: true, default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateProductVariantDto extends PartialType(
  CreateProductVariantDto,
) {}

export class ProductVariantDto {
  @ApiProperty({ example: '25' })
  id: string;

  @ApiProperty({ example: '35' })
  productId: string;

  @ApiProperty({ example: 'IPHONE-16-BLACK-256' })
  sku: string;

  @ApiProperty({ type: String, example: 'Qora-256 Gb', nullable: true })
  name: string | null;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    example: { color: 'Qora', storage: '256 Gb' },
  })
  attributes: Record<string, unknown>;

  @ApiProperty({ type: Number, example: 16000000, nullable: true })
  price: number | null;

  @ApiProperty({ type: Number, example: 17000000, nullable: true })
  oldPrice: number | null;

  @ApiProperty({ type: String, example: '4780012345678', nullable: true })
  barcode: string | null;

  @ApiProperty({
    type: String,
    example: 'https://cdn.example.com/products/iphone-black.jpg',
    nullable: true,
  })
  imageUrl: string | null;

  @ApiProperty({ example: true })
  isActive: boolean;
}
