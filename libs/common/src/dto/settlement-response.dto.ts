import { ApiProperty, ApiPropertyOptional, PickType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  WholesalerSettlementDto,
  WholesalerSettlementQueryDto,
} from './wholesaler-settlement.dto';

/**
 * BE-46 (FE-24, OPT-3, DZ-08): optovik akt-sverkani qabul qiladi yoki e’tiroz bildiradi; e’tiroz moliyaga boradi,
 * javobi shu aktda ko‘rinadi. To‘lov qabulni kutmaydi [taklif, BE-46 savol 4].
 */
export const FINANCE_SETTLEMENT_RESPONSE_RPC = {
  /** Optovik uchun: akt va javoblar; boshqa optovik akti — 403. */
  WHOLESALER_GET: 'finance.settlement.wholesaler.get',
  /** Moliya va admin uchun: akt, qabul va e’tirozlar (egasi tekshirilmaydi). */
  ACT: 'finance.settlement.act',
  ACCEPT: 'finance.settlement.accept',
  DISPUTE: 'finance.settlement.dispute',
  DISPUTES: 'finance.settlement.disputes',
  ANSWER: 'finance.settlement.dispute.answer',
} as const;

export enum SettlementDisputeStatus {
  OPEN = 'OPEN',
  ANSWERED = 'ANSWERED',
}

export class SettlementDisputeDto {
  @ApiProperty({ example: '3' }) id: string;
  @ApiProperty({ example: '12' }) settlementId: string;
  @ApiProperty({ example: 'AS-000012' }) settlementNumber: string;
  @ApiProperty({ example: '501' }) wholesalerId: string;
  @ApiProperty({ example: 'Quloqchin 2 donasi aktda yo‘q' }) comment: string;
  @ApiProperty({ example: '77', description: 'Optovik foydalanuvchisi' })
  createdBy: string;

  @ApiProperty({ example: '2027-01-11T06:00:00.000Z' }) createdAt: Date;
  @ApiProperty({ enum: SettlementDisputeStatus })
  status: SettlementDisputeStatus;

  @ApiProperty({ example: null, nullable: true, type: String })
  answer: string | null;

  @ApiProperty({ example: null, nullable: true, type: String })
  answeredBy: string | null;

  @ApiProperty({ example: null, nullable: true, type: Date })
  answeredAt: Date | null;
}

export class WholesalerActDto {
  @ApiProperty({ type: WholesalerSettlementDto })
  settlement: WholesalerSettlementDto;

  @ApiProperty({
    example: null,
    nullable: true,
    type: Date,
    description: 'Optovik aktni qabul qilgan vaqt',
  })
  acceptedAt: Date | null;

  @ApiProperty({ example: null, nullable: true, type: String })
  acceptedBy: string | null;

  @ApiProperty({
    example: null,
    nullable: true,
    type: Number,
    description:
      'Qabul qilingan summa, so‘m. Bank faylida summa o‘zgarsa qabul amalda emas (null) — qayta qabul yoki e’tiroz',
  })
  acceptedAmount: number | null;

  @ApiProperty({ type: [SettlementDisputeDto], description: 'Eskisi birinchi' })
  disputes: SettlementDisputeDto[];
}

export class SettlementCommentDto {
  @ApiProperty({ example: 'Quloqchin 2 donasi aktda yo‘q' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  comment: string;
}

export class SettlementDisputeQueryDto {
  @ApiPropertyOptional({ enum: SettlementDisputeStatus })
  @IsOptional()
  @IsEnum(SettlementDisputeStatus)
  status?: SettlementDisputeStatus;

  @ApiPropertyOptional({ example: '12', description: 'Akt ID si' })
  @IsOptional()
  @Matches(/^\d{1,19}$/)
  settlementId?: string;

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

export class SettlementDisputePageDto {
  @ApiProperty({ type: [SettlementDisputeDto] }) items: SettlementDisputeDto[];
  @ApiProperty({ example: 1 }) total: number;
  @ApiProperty({ example: 1 }) page: number;
  @ApiProperty({ example: 20 }) limit: number;
  @ApiProperty({ example: 1 }) totalPages: number;
}

/** Optovik o‘z aktlari ro‘yxati: optovik ID si so‘rovdan emas, foydalanuvchidan olinadi. */
export class WholesalerOwnSettlementQueryDto extends PickType(
  WholesalerSettlementQueryDto,
  ['page', 'limit', 'status', 'periodEnd'] as const,
) {}
