import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
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

/**
 * Optovik bilan haftalik hisob-kitob va akt-sverka (BE-23 dan keyin BE-33; TZ 6.8 MOL-7, T01:117) [taklif nomlar].
 * Har dushanba 09:00 (Toshkent): Elchi puli kelgan (AVAILABLE) va qaytarish muddati o‘tgan tovarlar optovik bo‘yicha
 * aktga yig‘iladi; moliya bankda o‘tkazib «To‘landi» belgilaydi.
 */
export enum WholesalerSettlementStatus {
  /** Tuzildi, bank fayli hali olinmagan. */
  READY = 'READY',
  /** Bank faylida — summa muzlatilgan (exportedTotal), «To‘landi» kutilmoqda. */
  EXPORTED = 'EXPORTED',
  PAID = 'PAID',
  /** Hammasi oldingi qaytarishlar qarziga ushlandi — o‘tkazma yo‘q. */
  NETTED = 'NETTED',
  /** Fayl olinguncha hamma tovar qaytdi — o‘tkazma yo‘q. */
  VOID = 'VOID',
}

export const FINANCE_SETTLEMENT_RPC = {
  RUN: 'finance.settlement.run',
  LIST: 'finance.settlement.list',
  GET: 'finance.settlement.get',
  PAID: 'finance.settlement.paid',
  ACT_PDF: 'finance.settlement.act-pdf',
  BANK_FILE: 'finance.settlement.bank-file',
  /** BE-33 (QA): qaytarish muddati va to‘lovchi (platforma) rekvizitlari — EQ-05, EQ-10 qarorlari kiritiladi. */
  SETTINGS_GET: 'finance.settlement.settings-get',
  SETTINGS_UPDATE: 'finance.settlement.settings-update',
} as const;

/** Hisob-kitob sozlamalari (BE-33): EQ-10 — qaytarish muddati, EQ-05 — to‘lovchi rekvizitlari. */
export class SettlementSettingsDto {
  @ApiProperty({
    example: 10,
    nullable: true,
    type: Number,
    description:
      'Qaytarish muddati, kun (EQ-10); bo‘sh — dushanbalik akt tuzilmaydi',
  })
  returnWindowDays: number | null;

  @ApiProperty({
    nullable: true,
    type: String,
    example: 'Elchi Marketplace MChJ',
  })
  payerName: string | null;

  @ApiProperty({ nullable: true, type: String, example: '305000000' })
  payerTin: string | null;

  @ApiProperty({
    nullable: true,
    type: String,
    example: '20208000900100000001',
  })
  payerAccount: string | null;

  @ApiProperty({ nullable: true, type: String, example: '00450' })
  payerMfo: string | null;

  @ApiProperty({
    nullable: true,
    type: String,
    example: '00668',
    description: 'To‘lov maqsadi kodi',
  })
  paymentPurposeCode: string | null;
}

export class UpdateSettlementSettingsDto {
  @ApiPropertyOptional({ example: 10, description: 'Kun, 0–365' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  returnWindowDays?: number;

  @ApiPropertyOptional({ example: 'Elchi Marketplace MChJ' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  payerName?: string;

  @ApiPropertyOptional({ example: '305000000', description: 'STIR, 9 raqam' })
  @IsOptional()
  @Matches(/^\d{9}$/, { message: 'STIR 9 raqam bo‘lishi kerak' })
  payerTin?: string;

  @ApiPropertyOptional({
    example: '20208000900100000001',
    description: 'Hisob raqami, 20 raqam',
  })
  @IsOptional()
  @Matches(/^\d{20}$/, { message: 'Hisob raqami 20 raqam bo‘lishi kerak' })
  payerAccount?: string;

  @ApiPropertyOptional({ example: '00450', description: 'MFO, 5 raqam' })
  @IsOptional()
  @Matches(/^\d{5}$/, { message: 'MFO 5 raqam bo‘lishi kerak' })
  payerMfo?: string;

  @ApiPropertyOptional({
    example: '00668',
    description: 'To‘lov maqsadi kodi, 5 raqam [taklif]',
  })
  @IsOptional()
  @Matches(/^\d{5}$/, { message: 'To‘lov maqsadi kodi 5 raqam bo‘lishi kerak' })
  paymentPurposeCode?: string;
}

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

  @ApiProperty({
    example: null,
    nullable: true,
    type: Number,
    description:
      'Bank fayliga kirgan (muzlatilgan) summa — «To‘landi» aynan shuni yozadi',
  })
  exportedTotal: number | null;

  @ApiProperty({
    example: 0,
    description: 'Oldingi qaytarishlardan qolgan qarzga ushlangan summa',
  })
  debtDeducted: number;

  @ApiProperty({ example: null, nullable: true, type: Date })
  exportedAt: Date | null;

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
      'RETURN_WINDOW_NOT_SET — qaytarish muddati (EQ-10) sozlanmagan, akt tuzilmadi; ' +
      'PERIOD_ALREADY_EXPORTED — davrning bank fayli olingan, yangi akt tuzilmadi (qatorlar keyingi haftaga)',
  })
  skipped: string | null;

  @ApiProperty({ example: 3, description: 'Tuzilgan yoki to‘ldirilgan aktlar' })
  settlements: number;

  @ApiProperty({ example: 7, description: 'Aktga kirgan tovar qatorlari' })
  items: number;
}

/**
 * BE-47 (TZ 6.12): optovikka «Pul o‘tkazildi» — gateway «To‘landi» dan keyin notification-service ga (sotuvchidagi
 * `finance.withdrawal.paid` kabi). Takror bosilsa ham bitta xabar (`dedupeKey` = akt).
 */
export const SETTLEMENT_PAID_EVENT = 'finance.wholesaler.paid';

export interface SettlementPaidEvent {
  settlementId: string;
  /** Akt raqami (masalan, OPT-2026-48). */
  number: string;
  wholesalerId: string;
  /** Bankka o‘tkazilgan summa, so‘m. */
  amount: number;
  periodStart: string;
  periodEnd: string;
}
