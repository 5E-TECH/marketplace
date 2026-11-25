import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { ProductDto } from './product.dto';

export class FavoritesQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;
}

export class FavoriteDto {
  @ApiProperty({ example: '12' }) id: string;
  @ApiProperty({ type: String, example: '42', nullable: true }) userId:
    string | null;
  @ApiProperty({ type: String, example: 'guest-session-uuid', nullable: true })
  sessionId: string | null;
  @ApiProperty({ example: '85' }) productId: string;
  // eski sevimlilar (gateway yo‘li BE-18 da yopilgan) — eski mahsulot shakli
  @ApiProperty({ type: ProductDto }) product: ProductDto;
  @ApiProperty({ example: '2026-08-25T10:00:00.000Z' }) createdAt: Date;
}

export interface FavoriteOwnerDto {
  userId?: string;
  sessionId?: string;
}

export class FavoritesPageDto {
  @ApiProperty({ type: [FavoriteDto] }) items: FavoriteDto[];
  @ApiProperty({ example: 12 }) total: number;
  @ApiProperty({ example: 1 }) page: number;
  @ApiProperty({ example: 20 }) limit: number;
  @ApiProperty({ example: 1 }) totalPages: number;
}
