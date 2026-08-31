import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateReviewDto {
  @ApiProperty({ example: '31', description: 'sales_order_item ID' })
  @IsString()
  @MaxLength(30)
  orderItemId: string;

  @ApiProperty({ example: 5, minimum: 1, maximum: 5 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;

  @ApiPropertyOptional({ example: 'Mahsulot juda yaxshi ekan' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;
}

export class ReviewsQueryDto {
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

export interface ReviewEligibilityDto {
  orderItemId: string;
  customerId: string;
  productId: string;
  shopId: string;
  sellerOrderId: string;
  status: string;
}
