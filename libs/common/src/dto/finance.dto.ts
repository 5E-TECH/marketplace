import {
  ApiProperty,
  ApiPropertyOptional,
  IntersectionType,
  OmitType,
} from '@nestjs/swagger';
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
import {
  CommissionType,
  FinancePayoutStatus,
  PayoutScheduleFrequency,
} from '../enums';

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
  /**
   * C4.2 — qisman qaytarish: sotuvchidan faqat shu summa (komissiyaning
   * mos ulushi qaytarilgan holda) yechiladi. Berilmasa butun sotuv teskari
   * yoziladi (eski oqim).
   */
  amount?: number;
  /** Qisman qaytarishda idempotentlik kaliti — return_request ID. */
  returnRequestId?: string;
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

/** Davr filtri: ikkala chegara ham kun bo'yicha, `dateTo` kuni ham kiradi. */
export class FinanceDateRangeQueryDto {
  @ApiPropertyOptional({ example: '2026-09-01' })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional({ example: '2026-09-30' })
  @IsOptional()
  @IsDateString()
  dateTo?: string;
}

export class FinanceReconciliationQueryDto extends FinanceDateRangeQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  shopId?: string;
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

export class FinanceLedgerQueryDto extends IntersectionType(
  FinancePageQueryDto,
  FinanceDateRangeQueryDto,
) {}

export class FinancePayoutQueryDto extends FinancePageQueryDto {
  @ApiPropertyOptional({ enum: FinancePayoutStatus })
  @IsOptional()
  @IsEnum(FinancePayoutStatus)
  status?: FinancePayoutStatus;
}

// Sotuvchi query'larida `shopId` yo'q: do'kon faqat tokendan aniqlanadi.
// Global `forbidNonWhitelisted` tufayli `?shopId=` yuborilsa 400 qaytadi.
export class SellerFinanceLedgerQueryDto extends OmitType(
  FinanceLedgerQueryDto,
  ['shopId'] as const,
) {}

export class SellerFinancePayoutQueryDto extends OmitType(
  FinancePayoutQueryDto,
  ['shopId'] as const,
) {}

export class UpdatePayoutScheduleDto {
  @ApiProperty({ enum: PayoutScheduleFrequency, example: 'WEEKLY' })
  @IsEnum(PayoutScheduleFrequency)
  frequency: PayoutScheduleFrequency;
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
