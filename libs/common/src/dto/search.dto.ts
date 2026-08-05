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

export class SearchProductsQueryDto {
  @ApiProperty({ example: 'telefon' })
  @IsString()
  @MaxLength(255)
  @Matches(/\S/, { message: "q bo'sh bo'lishi mumkin emas" })
  q: string;

  @ApiPropertyOptional({ example: '7' })
  @IsOptional()
  @Matches(/^\d+$/, { message: "categoryId musbat son bo'lishi kerak" })
  categoryId?: string;

  @ApiPropertyOptional({ minimum: 0, example: 100000 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  minPrice?: number;

  @ApiPropertyOptional({ minimum: 0, example: 5000000 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  maxPrice?: number;

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

export class SearchProductItemDto {
  @ApiProperty({ example: '12' }) productId: string;
  @ApiProperty({ example: '5' }) shopId: string;
  @ApiProperty({ example: 'iphone-16-pro' }) slug: string;
  @ApiProperty({ example: 'iPhone 16 Pro' }) title: string;
  @ApiProperty({ example: 'Ali Market' }) shopName: string;
  @ApiProperty({ example: '7', nullable: true }) categoryId: string | null;
  @ApiProperty({ example: 14999000 }) price: number;
  @ApiProperty({ example: null, nullable: true }) imageUrl: string | null;
  @ApiProperty({ example: { brand: 'Apple' } })
  attributes: Record<string, unknown>;
  @ApiProperty({ example: 0.42 }) relevance: number;
}

export class SearchFacetDto {
  @ApiProperty({
    example: [
      { categoryId: '7', count: 12 },
      { categoryId: '8', count: 4 },
    ],
  })
  categories: Array<{ categoryId: string; count: number }>;
  @ApiProperty({ example: 100000, nullable: true }) minPrice: number | null;
  @ApiProperty({ example: 15000000, nullable: true }) maxPrice: number | null;
}

export class SearchProductsPageDto {
  @ApiProperty({ type: [SearchProductItemDto] }) items: SearchProductItemDto[];
  @ApiProperty({ example: 16 }) total: number;
  @ApiProperty({ example: 1 }) page: number;
  @ApiProperty({ example: 20 }) limit: number;
  @ApiProperty({ example: 1 }) totalPages: number;
  @ApiProperty({ type: SearchFacetDto }) facets: SearchFacetDto;
}

export interface CatalogProductChangedEvent {
  productId: string;
  shopId: string;
  categoryId: string | null;
  title: string;
  content: string | null;
  slug: string;
  imageUrl: string | null;
  shopName: string;
  price: number;
  attributes: Record<string, unknown>;
  active: boolean;
}
