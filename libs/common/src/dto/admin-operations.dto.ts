import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { SalesOrderSellerStatus, StockMovementType } from '../enums';
import { StockItemDto, StockQueryDto } from './inventory.dto';

export class AdminStockQueryDto extends StockQueryDto {
  @ApiPropertyOptional({ example: '15' })
  @IsOptional()
  @Matches(/^[1-9]\d*$/, { message: "shopId musbat son bo'lishi kerak" })
  shopId?: string;
}

export class AdminStockItemDto extends StockItemDto {
  @ApiProperty({ example: '15' })
  shopId: string;
}

export class AdminStockPageDto {
  @ApiProperty({ type: [AdminStockItemDto] }) items: AdminStockItemDto[];
  @ApiProperty({ example: 25 }) total: number;
  @ApiProperty({ example: 1 }) page: number;
  @ApiProperty({ example: 20 }) limit: number;
  @ApiProperty({ example: 2 }) totalPages: number;
}

class AdminPageQueryDto {
  @ApiPropertyOptional({ example: 1, default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ example: 20, default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}

export class AdminStockMovementsQueryDto extends AdminPageQueryDto {
  @ApiPropertyOptional({ example: '15' })
  @IsOptional()
  @Matches(/^[1-9]\d*$/)
  shopId?: string;

  @ApiPropertyOptional({ example: '3' })
  @IsOptional()
  @Matches(/^[1-9]\d*$/)
  warehouseId?: string;

  @ApiPropertyOptional({ example: '88' })
  @IsOptional()
  @Matches(/^[1-9]\d*$/)
  variantId?: string;

  @ApiPropertyOptional({ enum: StockMovementType })
  @IsOptional()
  @IsEnum(StockMovementType)
  type?: StockMovementType;

  @ApiPropertyOptional({ example: '2026-09-01T00:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional({ example: '2026-09-30T23:59:59.999Z' })
  @IsOptional()
  @IsDateString()
  dateTo?: string;
}

export class AdminShipmentsQueryDto extends AdminPageQueryDto {
  @ApiPropertyOptional({ example: '15' })
  @IsOptional()
  @Matches(/^[1-9]\d*$/)
  shopId?: string;

  @ApiPropertyOptional({ enum: SalesOrderSellerStatus })
  @IsOptional()
  @IsEnum(SalesOrderSellerStatus)
  status?: SalesOrderSellerStatus;

  @ApiPropertyOptional({ example: '1251131' })
  @IsOptional()
  @Matches(/^[1-9]\d*$/)
  shipmentId?: string;

  @ApiPropertyOptional({ example: '2026-09-01T00:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional({ example: '2026-09-30T23:59:59.999Z' })
  @IsOptional()
  @IsDateString()
  dateTo?: string;
}

export class AdminWebhooksQueryDto extends AdminPageQueryDto {
  @ApiPropertyOptional({ example: 'evt_123' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  eventId?: string;

  @ApiPropertyOptional({ example: '1251131' })
  @IsOptional()
  @Matches(/^[1-9]\d*$/)
  shipmentId?: string;

  @ApiPropertyOptional({ example: '9' })
  @IsOptional()
  @Matches(/^[1-9]\d*$/)
  sellerOrderId?: string;

  @ApiPropertyOptional({ enum: SalesOrderSellerStatus })
  @IsOptional()
  @IsEnum(SalesOrderSellerStatus)
  status?: SalesOrderSellerStatus;

  @ApiPropertyOptional({ example: '2026-09-01T00:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional({ example: '2026-09-30T23:59:59.999Z' })
  @IsOptional()
  @IsDateString()
  dateTo?: string;
}

export class AdminStockMovementItemDto {
  @ApiProperty() id: string;
  @ApiProperty() shopId: string;
  @ApiProperty() variantId: string;
  @ApiProperty() warehouseId: string;
  @ApiProperty() warehouseName: string;
  @ApiProperty({ enum: StockMovementType }) type: StockMovementType;
  @ApiProperty() quantity: number;
  @ApiProperty() onHandAfter: number;
  @ApiProperty() reservedAfter: number;
  @ApiProperty({ nullable: true }) referenceType: string | null;
  @ApiProperty({ nullable: true }) referenceId: string | null;
  @ApiProperty({ nullable: true }) reason: string | null;
  @ApiProperty({ nullable: true }) actorId: string | null;
  @ApiProperty() createdAt: Date;
}

export class AdminStockMovementsPageDto {
  @ApiProperty({ type: [AdminStockMovementItemDto] })
  items: AdminStockMovementItemDto[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
  @ApiProperty() totalPages: number;
}
