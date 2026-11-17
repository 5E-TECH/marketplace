import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Matches, Max, Min } from 'class-validator';

/**
 * Optovik bilan haftalik hisob-kitob va akt-sverka (BE-23 dan keyin BE-33; TZ 6.8 MOL-7, T01:117) [taklif nomlar].
 * Har dushanba 09:00 (Toshkent): Elchi puli kelgan (AVAILABLE) va qaytarish muddati o‘tgan tovarlar optovik bo‘yicha
 * aktga yig‘iladi; moliya bankda o‘tkazib «To‘landi» belgilaydi.
 */
export enum WholesalerSettlementStatus {
  READY = 'READY',
  PAID = 'PAID',
}

export const FINANCE_SETTLEMENT_RPC = {
  RUN: 'finance.settlement.run',
  LIST: 'finance.settlement.list',
  GET: 'finance.settlement.get',
  PAID: 'finance.settlement.paid',
  ACT_PDF: 'finance.settlement.act-pdf',
  BANK_FILE: 'finance.settlement.bank-file',
} as const;

export class WholesalerSettlementItemDto {
  @ApiProperty({ example: '9001' }) orderId: string;
  @ApiProperty({ example: '88', nullable: true, type: String })
  productId: string | null;

  @ApiProperty({ example: 1, nullable: true, type: Number })
  quantity: number | null;

  @ApiProperty({ example: 140000, description: 'Bazaviy narx × soni, so‘m' })
  amount: number;

  @ApiProperty({
    example: '2027-01-02T10:00:00.000Z',
    description: 'Yetkazilgan vaqt',
  })
  deliveredAt: Date;
}

export class WholesalerSettlementDto {
  @ApiProperty({ example: '12' }) id: string;
  @ApiProperty({ example: 'AS-000012', description: 'Akt raqami' })
  number: string;

  @ApiProperty({
    example: '501',
    description: 'Optovik ID si (ledger WHOLESALER hisobi egasi)',
  })
  wholesalerId: string;

  @ApiProperty({
    example: '2027-01-04',
    description: 'Davr boshi (dushanba), Toshkent',
  })
  periodStart: string;

  @ApiProperty({
    example: '2027-01-10',
    description: 'Davr oxiri (yakshanba), Toshkent',
  })
  periodEnd: string;

  @ApiProperty({
    example: 10,
    description: 'Qaytarish muddati, kun (EQ-10 sozlamasi)',
  })
  returnWindowDays: number;

  @ApiProperty({
    enum: WholesalerSettlementStatus,
    example: WholesalerSettlementStatus.READY,
  })
  status: WholesalerSettlementStatus;

  @ApiProperty({ example: 280000, description: 'O‘tkaziladigan summa, so‘m' })
  totalAmount: number;

  @ApiProperty({ example: 2 }) itemsCount: number;

  @ApiProperty({ type: [WholesalerSettlementItemDto] })
  items: WholesalerSettlementItemDto[];

  @ApiProperty({ example: '2027-01-11T04:00:00.000Z' }) createdAt: Date;

  @ApiProperty({ example: null, nullable: true, type: Date })
  paidAt: Date | null;

  @ApiProperty({ example: null, nullable: true, type: String })
  paidBy: string | null;
}

export class WholesalerSettlementPageDto {
  @ApiProperty({ type: [WholesalerSettlementDto] })
  items: WholesalerSettlementDto[];
  @ApiProperty({ example: 1 }) total: number;
  @ApiProperty({ example: 1 }) page: number;
  @ApiProperty({ example: 20 }) limit: number;
  @ApiProperty({ example: 1 }) totalPages: number;
}

export class WholesalerSettlementQueryDto {
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

  @ApiPropertyOptional({ enum: WholesalerSettlementStatus })
  @IsOptional()
  @IsEnum(WholesalerSettlementStatus)
  status?: WholesalerSettlementStatus;

  @ApiPropertyOptional({ example: '501' })
  @IsOptional()
  @Matches(/^\d{1,19}$/)
  wholesalerId?: string;

  @ApiPropertyOptional({
    example: '2027-01-10',
    description: 'Davr oxiri (yakshanba)',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  periodEnd?: string;
}

export class BankFileQueryDto {
  @ApiProperty({
    example: '2027-01-10',
    description: 'Davr oxiri (yakshanba): shu davrning tayyor aktlari',
  })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  periodEnd: string;
}

export class RunSettlementDto {
  @ApiPropertyOptional({
    example: '2027-01-11T04:00:00.000Z',
    description:
      'Qaysi lahza uchun (sukut — hozir); kesish — shu haftaning dushanbasi 00:00 Toshkent',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}T/)
  asOf?: string;
}

export class SettlementRunResultDto {
  @ApiProperty({ example: '2027-01-10' }) periodEnd: string;
  @ApiProperty({
    example: null,
    nullable: true,
    type: String,
    description:
      'RETURN_WINDOW_NOT_SET — qaytarish muddati (EQ-10) sozlanmagan, akt tuzilmadi',
  })
  skipped: string | null;

  @ApiProperty({ example: 3, description: 'Tuzilgan yoki to‘ldirilgan aktlar' })
  settlements: number;

  @ApiProperty({ example: 7, description: 'Aktga kirgan tovar qatorlari' })
  items: number;
}
