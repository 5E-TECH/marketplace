import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Matches,
  Min,
} from 'class-validator';

/** C6.3 — `GET /admin/audit` filtrlari va sahifalash. */
export class AdminAuditQueryDto {
  @ApiPropertyOptional({
    example: '15',
    description: 'Amalni bajargan user ID',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[1-9]\d*$/)
  @MaxLength(19)
  actorId?: string;

  @ApiPropertyOptional({ example: 'shop.suspend' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  action?: string;

  @ApiPropertyOptional({
    example: 'Product',
    description:
      'BE-27: ob’ekt turi (yozuvdagi `entityType`, masalan Product, User, FinanceSetting)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  entityType?: string;

  @ApiPropertyOptional({
    example: '12',
    description:
      'BE-27: ob’ekt ID si (`entityType` bilan birga — «shu mahsulot auditi»)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  entityId?: string;

  @ApiPropertyOptional({ example: '2026-09-01' })
  @IsOptional()
  @IsDateString({ strict: true })
  dateFrom?: string;

  @ApiPropertyOptional({ example: '2026-09-30' })
  @IsOptional()
  @IsDateString({ strict: true })
  dateTo?: string;

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
