import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, Matches } from 'class-validator';

/**
 * Kunlik COD sverkasi (BE-21; TZ ELC-4 «Kunlik sverka; farq bo‘lsa moliyaga ogohlantirish»): o‘sha kuni kelgan
 * Elchi o‘tkazmalari buyurtma jurnali bilan solishtiriladi (BE-22 moslashtirish natijasi).
 */
export const COD_DAILY_CHECK_RPC = {
  GET: 'finance.cod-daily-check.get',
  RUN: 'finance.cod-daily-check.run',
} as const;

/** finance → notification: sverkada farq (moliya va nazoratchiga). */
export const COD_RECONCILIATION_MISMATCH_EVENT =
  'finance.cod.reconciliation.mismatch';

export interface CodReconciliationMismatchEvent {
  date: string;
  mismatchCount: number;
  /** Farqlar yig‘indisi (kelgan − kutilgan), so‘m. */
  diffTotal: number;
  orders: Array<{
    orderId: string;
    expected: number;
    received: number;
    diff: number;
  }>;
}

export class CodDailyCheckQueryDto {
  @ApiPropertyOptional({
    example: '2026-12-01',
    description: 'Sana (Toshkent); bo‘sh — kecha',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Sana YYYY-MM-DD bo‘lishi kerak' })
  date?: string;
}

export class CodDailyCheckMismatchDto {
  @ApiProperty({ example: '55' })
  orderId: string;

  @ApiPropertyOptional({ example: '1251134' })
  shipmentId: string | null;

  @ApiProperty({ example: 'paid' })
  elchiStatus: string;

  @ApiProperty({ example: 265000 })
  expected: number;

  @ApiProperty({ example: 255000 })
  received: number;

  @ApiProperty({ example: -10000 })
  diff: number;
}

export class CodDailyCheckDto {
  @ApiProperty({ example: '2026-12-01' })
  date: string;

  @ApiProperty({ description: 'Mos (HOLD → AVAILABLE)' })
  matched: number;

  @ApiProperty({ description: 'Qisman to‘langan (partly_paid)' })
  partial: number;

  @ApiProperty({ description: 'Mos emas — ogohlantirish' })
  mismatch: number;

  @ApiProperty({ description: 'Buyurtma hodisasi hali kelmagan' })
  pending: number;

  @ApiProperty({ description: 'Kutilgan jami, so‘m' })
  expectedTotal: number;

  @ApiProperty({ description: 'Kelgan jami, so‘m' })
  receivedTotal: number;

  @ApiProperty({ type: [CodDailyCheckMismatchDto] })
  mismatches: CodDailyCheckMismatchDto[];

  @ApiProperty()
  computedAt: Date;

  @ApiPropertyOptional({
    description: 'Moliya va nazoratchiga xabar yuborilgan vaqt',
  })
  alertedAt: Date | null;
}
