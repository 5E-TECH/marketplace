import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { MAX_MONEY } from '../database/money.transformer';

/**
 * BE-27 (ADM-2): moliya sozlamalari — `finance.setting` (kalit, qiymat, kuchga kirish vaqti; BE-22). Qiymat
 * hodisa vaqtidagi amaldagisi bo‘yicha olinadi, shuning uchun kelajak sanasi bilan rejalashtirish mumkin.
 * `return_window_days` — BE-33 sozlamalari endpointida (PR 131), bu yerda emas.
 */
export enum FinanceSettingKey {
  /** Rad etilgan posilka uchun to‘lov, so‘m (seed 20 000 — BE-22, 6-qaror, MOL-3). */
  REFUSAL_FEE = 'refusal_fee',
  /** Minimal pul yechish, so‘m (seed 50 000 — BE-23). */
  WITHDRAWAL_MIN = 'withdrawal_min',
}

export const FINANCE_SETTINGS_RPC = {
  LIST: 'finance.settings.list',
  SET: 'finance.settings.set',
  CANCEL: 'finance.settings.cancel',
} as const;

export class FinanceSettingValueDto {
  @ApiProperty({ example: 20000, description: 'Butun so‘m' })
  value: number;
  @ApiProperty({ example: '2026-12-01T00:00:00.000Z' })
  effectiveFrom: string;
  @ApiProperty({
    example: 'user:7',
    nullable: true,
    type: String,
    description: 'Kim kiritdi (`user:<id>` yoki migratsiya)',
  })
  changedBy: string | null;
}

export class FinanceSettingStateDto {
  @ApiProperty({
    enum: FinanceSettingKey,
    example: FinanceSettingKey.REFUSAL_FEE,
  })
  key: FinanceSettingKey;
  @ApiProperty({ type: FinanceSettingValueDto, nullable: true })
  current: FinanceSettingValueDto | null;
  @ApiProperty({
    type: [FinanceSettingValueDto],
    description: 'Kelajakda kuchga kiradiganlar (eng yaqini birinchi)',
  })
  scheduled: FinanceSettingValueDto[];
  @ApiProperty({
    type: [FinanceSettingValueDto],
    description: 'Oldingi qiymatlar, yangisi birinchi (ko‘pi bilan 20)',
  })
  history: FinanceSettingValueDto[];
}

/** `PUT /admin/finance/settings/{key}` — yangi qiymat; izoh — kim so‘radi va nega (audit). */
export class UpdateFinanceSettingDto {
  @ApiProperty({ example: 20000, minimum: 0, description: 'Butun so‘m' })
  @IsInt()
  @Min(0)
  @Max(MAX_MONEY)
  value: number;

  @ApiPropertyOptional({
    example: '2026-12-01T00:00:00+05:00',
    description:
      'Kuchga kirish vaqti; berilmasa — hozir. Faqat sana — Toshkent kuni boshi. O‘tmish vaqti — 400',
  })
  @IsOptional()
  @IsDateString({ strict: true })
  effectiveFrom?: string;

  @ApiProperty({
    example: 'Moliya bo‘limi so‘rovi (Dilnoza, 2026-11-22): Elchi tarifi oshdi',
    description: 'Izoh majburiy: kim so‘radi va sabab',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  comment: string;
}

export interface FinanceSettingSetInput {
  key: string;
  value: number;
  effectiveFrom?: string;
  actorId: string;
  /** Kim so‘radi va sabab — sozlama qatorida ham saqlanadi (audit yo‘qolsa ham qoladi). */
  comment: string;
}

/** `POST /admin/finance/settings/{key}/cancel` — hali kuchga kirmagan rejalashtirilgan qiymatni bekor qilish. */
export class CancelFinanceSettingDto {
  @ApiProperty({ example: '2026-12-01T00:00:00.000Z' })
  @IsDateString({ strict: true })
  effectiveFrom: string;

  @ApiProperty({ example: 'Xato kiritilgan (Dilnoza, 2026-11-22)' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  comment: string;
}

export interface FinanceSettingCancelInput {
  key: string;
  effectiveFrom: string;
}

export interface FinanceSettingSetResult {
  key: FinanceSettingKey;
  /** Yangi qiymat kuchga kirgan paytda amalda bo‘lgan oldingi qiymat (audit uchun). */
  before: number | null;
  after: number;
  effectiveFrom: string;
  /** Shu vaqtdan keyin rejalashtirilgan qiymatlar — ular kuchga kirganda bu qiymatni almashtiradi. */
  laterScheduled: FinanceSettingValueDto[];
}
