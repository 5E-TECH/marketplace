import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { CommissionType, FinancePayoutStatus } from '../enums';

export interface FinancePayoutRequestedEvent {
  eventId: string;
  sellerOrderId: string;
  salesOrderId: string;
  shopId: string;
  amount: number;
  paymentMethod: string;
  occurredAt: string;
}

export interface FinanceRefundRequestedEvent {
  eventId: string;
  sellerOrderId: string;
  shopId: string;
  occurredAt: string;
}

export interface FinanceCodSettledEvent {
  eventId: string;
  sellerOrderId: string;
  salesOrderId: string;
  shopId: string;
  expectedAmount: number;
  collectedAmount: number;
  occurredAt: string;
}

export class FinanceReconciliationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  shopId?: string;

  @ApiPropertyOptional({ example: '2026-09-01' })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional({ example: '2026-09-30' })
  @IsOptional()
  @IsDateString()
  dateTo?: string;
}

export class FinancePageQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  shopId?: string;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class FinancePayoutQueryDto extends FinancePageQueryDto {
  @ApiPropertyOptional({ enum: FinancePayoutStatus })
  @IsOptional()
  @IsEnum(FinancePayoutStatus)
  status?: FinancePayoutStatus;
}

export class CreateCommissionDto {
  @ApiProperty({ enum: ['global', 'category', 'shop'] })
  @IsIn(['global', 'category', 'shop'])
  scope: 'global' | 'category' | 'shop';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  refId?: string;

  @ApiProperty({ enum: CommissionType })
  @IsEnum(CommissionType)
  type: CommissionType;

  @ApiProperty({ example: 10 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  value: number;
}

export class UpdateCommissionDto {
  @ApiPropertyOptional({ enum: CommissionType })
  @IsOptional()
  @IsEnum(CommissionType)
  type?: CommissionType;

  @ApiPropertyOptional({ example: 10 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  value?: number;
}
