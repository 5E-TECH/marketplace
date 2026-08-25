import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { StorefrontProductDto } from './storefront.dto';

export class FavoritesQueryDto {
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

export class FavoriteDto {
  @ApiProperty({ example: '12' }) id: string;
  @ApiProperty({ example: '42' }) userId: string;
  @ApiProperty({ example: '85' }) productId: string;
  @ApiProperty({ type: StorefrontProductDto }) product: StorefrontProductDto;
  @ApiProperty({ example: '2026-08-25T10:00:00.000Z' }) createdAt: Date;
}

export class FavoritesPageDto {
  @ApiProperty({ type: [FavoriteDto] }) items: FavoriteDto[];
  @ApiProperty({ example: 12 }) total: number;
  @ApiProperty({ example: 1 }) page: number;
  @ApiProperty({ example: 20 }) limit: number;
  @ApiProperty({ example: 1 }) totalPages: number;
}
