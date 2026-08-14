import { Type } from 'class-transformer';
import {
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ProductDto } from './product.dto';
import { ProductVariantDto } from './product-variant.dto';
import { SellerShopDto } from './seller.dto';

export class StorefrontCategoryDto {
  @ApiProperty({ example: '7' }) id: string;
  @ApiProperty({ example: 'Smartfonlar' }) name: string;
  @ApiProperty({ example: 'smartfonlar' }) slug: string;
  @ApiProperty({ example: '2', nullable: true }) parentId: string | null;
  @ApiProperty({ example: null, nullable: true }) iconUrl: string | null;
}

export class StorefrontProductDto extends ProductDto {
  @ApiProperty({
    type: SellerShopDto,
    description: 'Product qaysi marketga tegishli ekanini bildiradi',
  })
  shop: SellerShopDto;

  @ApiProperty({ type: StorefrontCategoryDto, nullable: true })
  category: StorefrontCategoryDto | null;

  @ApiProperty({ type: [ProductVariantDto] })
  variants: ProductVariantDto[];
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
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  minPrice?: number;

  @ApiPropertyOptional({ example: 15000000, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  maxPrice?: number;

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

export class StorefrontShopPageDto {
  @ApiProperty({ type: SellerShopDto }) shop: SellerShopDto;
  @ApiProperty({ type: StorefrontProductsPageDto })
  products: StorefrontProductsPageDto;
}
