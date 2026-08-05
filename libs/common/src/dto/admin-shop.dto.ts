import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ShopStatus } from '../enums';

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
  page = 1;

  @ApiPropertyOptional({ example: 20, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}

/** `POST /admin/shops/:id/reject` — ixtiyoriy sabab. */
export class RejectShopDto {
  @ApiPropertyOptional({ example: 'Hujjatlar to‘liq emas' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
