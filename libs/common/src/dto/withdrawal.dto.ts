import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { MAX_MONEY } from '../database/money.transformer';

/**
 * Sotuvchining pul yechish so‘rovlari (BE-23; TZ 6.8 MOL-5, 6.1 SOT-7, T01:471) [taklif nomlar].
 * So‘raldi → Tasdiqlandi → To‘landi / Rad etildi. To‘lov qo‘lda yoki (BE-32) sotuvchi kartasiga avtomatik:
 * Tasdiqlandi → Yuborilmoqda → To‘landi / Xato (pul «Mavjud» da qoladi, MOL-6).
 */
export enum WithdrawalStatus {
  REQUESTED = 'REQUESTED',
  APPROVED = 'APPROVED',
  /** BE-32: kartaga yuborildi, provayder javobi kutilmoqda — qayta yuborilmaydi, qo‘lda «To‘landi»/rad yo‘q. */
  PAYING = 'PAYING',
  PAID = 'PAID',
  REJECTED = 'REJECTED',
  /** BE-32: provayder rad etdi — ledgerga yozilmagan, pul «Mavjud» da; sotuvchi yangi so‘rov yuboradi. */
  FAILED = 'FAILED',
}

/** BE-32: pul qanday o‘tkaziladi — moliya qo‘lda yoki provayder orqali sotuvchi kartasiga. */
export enum WithdrawalPayoutMode {
  MANUAL = 'MANUAL',
  CARD = 'CARD',
}

/** Nega so‘rov yuborib bo‘lmaydi (kabinetda tugma yopiq, sababi bilan). */
export enum WithdrawalBlockReason {
  /** O‘zini o‘zi band qilganlik belgisi yo‘q (T01:471). */
  NOT_SELF_EMPLOYED = 'NOT_SELF_EMPLOYED',
  /** Bugun so‘rov yuborilgan (kuniga 1 ta, Toshkent kuni). */
  DAILY_LIMIT = 'DAILY_LIMIT',
  /** Yechish mumkin bo‘lgan summa minimaldan kam. */
  BELOW_MIN = 'BELOW_MIN',
}

export const FINANCE_WITHDRAWAL_RPC = {
  BALANCE: 'finance.withdrawal.balance',
  CREATE: 'finance.withdrawal.create',
  LIST_MINE: 'finance.withdrawal.list-mine',
  ADMIN_LIST: 'finance.withdrawal.admin-list',
  GET: 'finance.withdrawal.get',
  APPROVE: 'finance.withdrawal.approve',
  REJECT: 'finance.withdrawal.reject',
  PAID: 'finance.withdrawal.paid',
  SELF_EMPLOYED_SET: 'finance.affiliate.self-employed.set',
  /** BE-32: `PAYING` dagi so‘rovni moliya provayder kabinetida tekshirib qo‘lda yopadi. */
  PAYOUT_RESULT: 'finance.withdrawal.payout-result',
} as const;

export class AffiliateBalanceDto {
  @ApiProperty({ example: 130000, description: 'Ushlab turilgan (HOLD), so‘m' })
  hold: number;

  @ApiProperty({
    example: 1200000,
    description:
      'Mavjud (AVAILABLE), so‘m; qaytarishdan keyin manfiy bo‘lishi mumkin',
  })
  available: number;

  @ApiProperty({
    example: 0,
    description: 'Ochiq so‘rovlarda band (So‘raldi va Tasdiqlandi), so‘m',
  })
  reserved: number;

  @ApiProperty({
    example: 1200000,
    description: 'Yechish mumkin: mavjud − band (0 dan kam emas)',
  })
  withdrawable: number;

  @ApiProperty({ example: 50000, description: 'Eng kam so‘rov, so‘m' })
  minAmount: number;

  @ApiProperty({ example: 1, description: 'Ushlanadigan soliq, %' })
  taxPercent: number;

  @ApiProperty({
    example: 5000000,
    description: 'Bundan katta so‘rov ikki xodim tasdig‘ini talab qiladi',
  })
  twoApprovalAbove: number;

  @ApiProperty({ example: true }) selfEmployed: boolean;

  @ApiProperty({
    enum: WithdrawalBlockReason,
    nullable: true,
    example: null,
    description: 'Bo‘sh — so‘rov yuborish mumkin',
  })
  blockReason: WithdrawalBlockReason | null;
}

export class CreateWithdrawalDto {
  @ApiProperty({
    example: 1000000,
    description: 'So‘ralgan summa, butun so‘m (soliq shundan ushlanadi)',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_MONEY)
  amount: number;
}

export class WithdrawalApprovalDto {
  @ApiProperty({ example: '7' }) approvedBy: string;
  @ApiProperty({ example: '2026-12-21T09:00:00.000Z' }) approvedAt: Date;
}

export class WithdrawalDto {
  @ApiProperty({ example: '12' }) id: string;
  @ApiProperty({ example: '42' }) affiliateId: string;

  @ApiProperty({ example: 1000000, description: 'So‘ralgan summa' })
  amount: number;

  @ApiProperty({ example: 10000, description: 'Ushlanadigan 1% soliq' })
  taxAmount: number;

  @ApiProperty({ example: 990000, description: 'Kartaga o‘tkaziladi' })
  netAmount: number;

  @ApiProperty({ enum: WithdrawalStatus, example: WithdrawalStatus.REQUESTED })
  status: WithdrawalStatus;

  @ApiProperty({ example: 1, description: 'Kerakli tasdiqlar soni (1 yoki 2)' })
  requiredApprovals: number;

  @ApiProperty({ type: [WithdrawalApprovalDto] })
  approvals: WithdrawalApprovalDto[];

  @ApiProperty({ example: null, nullable: true, type: String })
  rejectReason: string | null;

  @ApiProperty({ example: '2026-12-21T08:00:00.000Z' }) createdAt: Date;

  @ApiProperty({ example: null, nullable: true, type: Date })
  paidAt: Date | null;

  @ApiProperty({ example: null, nullable: true, type: String })
  paidBy: string | null;

  @ApiProperty({
    enum: WithdrawalPayoutMode,
    nullable: true,
    example: null,
    description:
      'BE-32: `CARD` — kartaga provayder orqali yuborilgan; `MANUAL` — moliya qo‘lda «To‘landi»; null — hali to‘lanmagan',
  })
  payoutMode: WithdrawalPayoutMode | null;

  @ApiProperty({
    example: null,
    nullable: true,
    type: String,
    description: 'Yuborilgan karta niqobi (`8600 **** **** 1234`)',
  })
  cardMask: string | null;

  @ApiProperty({
    example: null,
    nullable: true,
    type: Date,
    description: 'Kartaga yuborilgan vaqt',
  })
  payoutSentAt: Date | null;

  @ApiProperty({
    example: null,
    nullable: true,
    type: String,
    description: '`FAILED` sababi (provayder javobi yoki moliya izohi)',
  })
  failReason: string | null;

  @ApiProperty({ example: null, nullable: true, type: Date })
  failedAt: Date | null;

  @ApiProperty({
    example: false,
    description:
      'BE-32: tasdiqlangan so‘rov kartaga avtomatik yuboriladi (provayder yoqilgan, sotuvchida karta bor) — qo‘lda «To‘landi» yo‘q',
  })
  autoPayout: boolean;

  @ApiProperty({
    example: null,
    nullable: true,
    type: String,
    description:
      'BE-32: provayder natijasi holatga zid kelgan (moliya tekshiradi) — nima bo‘lgani; faqat moliya ro‘yxatida',
  })
  payoutConflict: string | null;
}

export class WithdrawalPageDto {
  @ApiProperty({ type: [WithdrawalDto] }) items: WithdrawalDto[];
  @ApiProperty({ example: 1 }) total: number;
  @ApiProperty({ example: 1 }) page: number;
  @ApiProperty({ example: 20 }) limit: number;
  @ApiProperty({ example: 1 }) totalPages: number;
}

export class WithdrawalQueryDto {
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

  @ApiPropertyOptional({ enum: WithdrawalStatus })
  @IsOptional()
  @IsEnum(WithdrawalStatus)
  status?: WithdrawalStatus;
}

export class AdminWithdrawalQueryDto extends WithdrawalQueryDto {
  @ApiPropertyOptional({ example: '42' })
  @IsOptional()
  @Matches(/^\d{1,19}$/)
  affiliateId?: string;
}

export class RejectWithdrawalDto {
  @ApiProperty({ example: 'Karta ma’lumoti noto‘g‘ri' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}

export class SetSelfEmployedDto {
  @ApiProperty({
    example: true,
    description:
      'O‘zini o‘zi band qilganlik maqomi tekshirildi (T01:471); moliya qo‘lda qo‘yadi',
  })
  @IsBoolean()
  selfEmployed: boolean;
}

export class AffiliateSelfEmployedDto {
  @ApiProperty({ example: '42' }) affiliateId: string;
  @ApiProperty({ example: true }) selfEmployed: boolean;
  @ApiProperty({ example: '7' }) updatedBy: string;
  @ApiProperty({ example: '2026-12-21T08:00:00.000Z' }) updatedAt: Date;
}
