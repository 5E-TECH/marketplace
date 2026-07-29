import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsBoolean,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateProductVariantDto {
  @ApiProperty({ example: 'IPHONE-16-BLACK-256' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  sku: string;

  @ApiPropertyOptional({ example: 'Qora-256 Gb', nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string | null;

  @ApiPropertyOptional({ example: { color: 'Qora', storage: '256 Gb' } })
  @IsOptional()
  @IsObject()
  attributes?: Record<string, unknown>;

  @ApiPropertyOptional({ example: 16000000, minimum: 0, nullable: true })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  price?: number | null;

  @ApiPropertyOptional({ example: 17000000, minimum: 0, nullable: true })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  oldPrice?: number | null;

  @ApiPropertyOptional({ example: '4780012345678', nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  barcode?: string | null;

  @ApiPropertyOptional({
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

  @ApiProperty({ example: 'Qora-256 Gb', nullable: true })
  name: string | null;

  @ApiProperty({ example: { color: 'Qora', storage: '256 Gb' } })
  attributes: Record<string, unknown>;

  @ApiProperty({ example: 16000000, nullable: true })
  price: number | null;

  @ApiProperty({ example: 17000000, nullable: true })
  oldPrice: number | null;

  @ApiProperty({ example: '4780012345678', nullable: true })
  barcode: string | null;

  @ApiProperty({
    example: 'https://cdn.example.com/products/iphone-black.jpg',
    nullable: true,
  })
  imageUrl: string | null;

  @ApiProperty({ example: true })
  isActive: boolean;
}
