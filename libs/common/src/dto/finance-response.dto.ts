import { ApiProperty } from '@nestjs/swagger';
import {
  CommissionType,
  FinanceLedgerEntryType,
  FinancePayoutStatus,
  PayoutScheduleFrequency,
} from '../enums';

// Moliya endpointlari javoblari (admin + sotuvchi). Pul — so'mda, 2 xonagacha.

export class FinanceLedgerEntryDto {
  @ApiProperty({ example: '501' }) id: string;
  @ApiProperty({ example: '7' }) shopId: string;
  @ApiProperty({ enum: FinanceLedgerEntryType, example: 'SALE' })
  entryType: FinanceLedgerEntryType;

  @ApiProperty({
    example: 250000,
    description: 'Musbat — sotuvchiga kirim, manfiy — yechim',
  })
  amount: number;

  @ApiProperty({
    example: 1180000,
    description: 'Shu yozuvdan keyingi balans',
  })
  balanceAfter: number;

  @ApiProperty({
    example: 'seller_order',
    description:
      'seller_order | cod_seller_order | seller_order_refund | return_request | payout',
  })
  referenceType: string;

  @ApiProperty({ example: '1203' }) referenceId: string;
  @ApiProperty({ example: '2026-09-28T10:15:00.000Z' }) createdAt: Date;
}

export class FinanceLedgerPageDto {
  @ApiProperty({ type: [FinanceLedgerEntryDto] })
  items: FinanceLedgerEntryDto[];
  @ApiProperty({ example: 42 }) total: number;
  @ApiProperty({ example: 1 }) page: number;
  @ApiProperty({ example: 20 }) limit: number;
  @ApiProperty({ example: 3 }) totalPages: number;
}

export class FinancePayoutDto {
  @ApiProperty({ example: '88' }) id: string;
  @ApiProperty({ example: '7' }) shopId: string;
  @ApiProperty({ example: 225000 }) amount: number;
  @ApiProperty({ enum: FinancePayoutStatus, example: 'PENDING' })
  status: FinancePayoutStatus;

  @ApiProperty({ example: null, nullable: true, type: String })
  method: string | null;

  @ApiProperty({
    example: '1203',
    description: 'Payout qaysi posilka (sales_order_seller) uchun ochilgan',
  })
  referenceId: string;

  @ApiProperty({ example: null, nullable: true, type: Date })
  paidAt: Date | null;

  @ApiProperty({ example: '2026-09-28T10:15:00.000Z' }) createdAt: Date;
  @ApiProperty({ example: '2026-09-28T10:15:00.000Z' }) updatedAt: Date;
}

export class FinancePayoutPageDto {
  @ApiProperty({ type: [FinancePayoutDto] }) items: FinancePayoutDto[];
  @ApiProperty({ example: 12 }) total: number;
  @ApiProperty({ example: 1 }) page: number;
  @ApiProperty({ example: 20 }) limit: number;
  @ApiProperty({ example: 1 }) totalPages: number;
}

export class FinanceReconciliationReportDto {
  @ApiProperty({
    example: 14,
    description: 'Elchi hisob-kitob qilgan COD posilkalar',
  })
  settlementsCount: number;

  @ApiProperty({ example: 3400000 }) expectedCodAmount: number;
  @ApiProperty({ example: 3400000 }) collectedCodAmount: number;

  @ApiProperty({ example: 0, description: 'collected − expected' })
  difference: number;

  @ApiProperty({ example: 340000, description: 'COD sotuvlardan komissiya' })
  expectedCommission: number;

  @ApiProperty({
    example: 200000,
    description: 'Online payout’lardan ushlab qolingan qismi',
  })
  nettedCommission: number;

  @ApiProperty({ example: 140000, description: 'Hali undirilmagan komissiya' })
  outstandingCommission: number;
}

export class FinanceCommissionDto {
  @ApiProperty({ example: '1' }) id: string;
  @ApiProperty({ example: null, nullable: true, type: String })
  shopId: string | null;
  @ApiProperty({ example: null, nullable: true, type: String })
  categoryId: string | null;
  @ApiProperty({ enum: CommissionType, example: 'PERCENT' })
  type: CommissionType;
  @ApiProperty({ example: 10 }) value: number;
  @ApiProperty({ example: '2026-09-01T00:00:00.000Z' }) createdAt: Date;
  @ApiProperty({ example: '2026-09-01T00:00:00.000Z' }) updatedAt: Date;
}

export class PayoutScheduleDto {
  @ApiProperty({ enum: PayoutScheduleFrequency, example: 'WEEKLY' })
  frequency: PayoutScheduleFrequency;

  @ApiProperty({
    example: true,
    description: 'Do‘kon hali tanlamagan — platforma default’i (WEEKLY)',
  })
  isDefault: boolean;

  @ApiProperty({
    example: '2026-10-05',
    description:
      'Bugungi tushum o‘tadigan eng yaqin to‘lov kuni (Asia/Tashkent, ' +
      'bugundan keyin): DAILY — ertaga, WEEKLY — dushanba, MONTHLY — oyning 1-kuni',
  })
  nextPayoutDate: string;

  @ApiProperty({ example: null, nullable: true, type: Date })
  updatedAt: Date | null;
}

export class SellerFinanceSummaryDto {
  @ApiProperty({ example: '7' }) shopId: string;

  @ApiProperty({
    example: 1180000,
    description:
      'Joriy ledger balansi: musbat — platforma sotuvchiga qarzdor, manfiy — ' +
      'sotuvchining komissiya qarzi (keyingi payout’dan ushlanadi). Davrga bog‘liq emas',
  })
  balance: number;

  @ApiProperty({
    example: 450000,
    description:
      'To‘lanishi kutilayotgan payout’lar (PENDING + APPROVED), hozirgi holat',
  })
  pendingPayoutAmount: number;

  @ApiProperty({ example: 0, description: 'Ushlab turilgan payout’lar (HELD)' })
  heldPayoutAmount: number;

  @ApiProperty({
    example: 2300000,
    description: 'Davr ichida to‘langan payout’lar (paid_at bo‘yicha)',
  })
  paidPayoutAmount: number;

  @ApiProperty({
    type: FinanceReconciliationReportDto,
    description:
      'COD reconciliation — /admin/finance/reports bilan bir xil, davr bo‘yicha',
  })
  cod: FinanceReconciliationReportDto;

  @ApiProperty({ enum: PayoutScheduleFrequency, example: 'WEEKLY' })
  payoutSchedule: PayoutScheduleFrequency;

  @ApiProperty({ example: '2026-10-05' }) nextPayoutDate: string;
}
