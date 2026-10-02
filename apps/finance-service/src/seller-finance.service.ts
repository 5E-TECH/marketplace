import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { FinanceDateRangeQueryDto, PayoutScheduleFrequency } from '@app/common';
import { dateRangeConditions } from './finance-query.util';
import { FinanceService, ReconciliationReportRow } from './finance.service';
import {
  DEFAULT_PAYOUT_FREQUENCY,
  nextPayoutDate,
} from './payout-schedule.util';

export interface PayoutScheduleRow {
  frequency: PayoutScheduleFrequency;
  isDefault: boolean;
  nextPayoutDate: string;
  updatedAt: Date | null;
}

export interface SellerFinanceSummaryRow {
  shopId: string;
  balance: number;
  pendingPayoutAmount: number;
  heldPayoutAmount: number;
  paidPayoutAmount: number;
  cod: ReconciliationReportRow;
  payoutSchedule: PayoutScheduleFrequency;
  nextPayoutDate: string;
}

/**
 * Sotuvchi kabineti moliyasi: mavjud ledger/payout/reconciliation
 * ma'lumotini bitta do'kon kesimida jamlaydi + payout chastotasi.
 * `shopId` doim gateway'da tokendan aniqlanadi.
 */
@Injectable()
export class SellerFinanceService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly finance: FinanceService,
  ) {}

  async summary(
    shopId: string,
    query: FinanceDateRangeQueryDto = {},
  ): Promise<SellerFinanceSummaryRow> {
    this.assertShop(shopId);
    const [balance, payouts, cod, schedule] = await Promise.all([
      this.finance.currentBalance(shopId),
      this.payoutTotals(shopId, query),
      this.finance.reconciliationReport({
        shopId,
        dateFrom: query.dateFrom,
        dateTo: query.dateTo,
      }),
      this.getSchedule(shopId),
    ]);
    return {
      shopId: String(shopId),
      balance,
      ...payouts,
      cod,
      payoutSchedule: schedule.frequency,
      nextPayoutDate: schedule.nextPayoutDate,
    };
  }

  async getSchedule(shopId: string): Promise<PayoutScheduleRow> {
    this.assertShop(shopId);
    const [row] = (await this.dataSource.query(
      `SELECT frequency,"updated_at" AS "updatedAt"
         FROM finance.payout_schedule WHERE shop_id=$1`,
      [shopId],
    )) as Array<{ frequency: PayoutScheduleFrequency; updatedAt: Date }>;
    return this.schedule(row?.frequency, row?.updatedAt);
  }

  async updateSchedule(
    shopId: string,
    frequency: PayoutScheduleFrequency,
  ): Promise<PayoutScheduleRow> {
    this.assertShop(shopId);
    if (!Object.values(PayoutScheduleFrequency).includes(frequency)) {
      throw new BadRequestException('Payout chastotasi noto‘g‘ri');
    }
    const [row] = (await this.dataSource.query(
      `INSERT INTO finance.payout_schedule(shop_id,frequency) VALUES($1,$2)
       ON CONFLICT (shop_id)
       DO UPDATE SET frequency=EXCLUDED.frequency,updated_at=now()
       RETURNING frequency,"updated_at" AS "updatedAt"`,
      [shopId, frequency],
    )) as Array<{ frequency: PayoutScheduleFrequency; updatedAt: Date }>;
    return this.schedule(row.frequency, row.updatedAt);
  }

  /**
   * Kutilayotgan va ushlangan payout'lar — hozirgi holat; to'langani —
   * davr ichida (`paid_at` bo'yicha).
   */
  private async payoutTotals(shopId: string, query: FinanceDateRangeQueryDto) {
    const params: unknown[] = [shopId];
    const paid = [
      `status='PAID'`,
      ...dateRangeConditions('paid_at', query, params),
    ].join(' AND ');
    const [row] = (await this.dataSource.query(
      `SELECT COALESCE(SUM(amount) FILTER (WHERE status IN ('PENDING','APPROVED')),0)::float8
                AS "pendingPayoutAmount",
              COALESCE(SUM(amount) FILTER (WHERE status='HELD'),0)::float8
                AS "heldPayoutAmount",
              COALESCE(SUM(amount) FILTER (WHERE ${paid}),0)::float8
                AS "paidPayoutAmount"
         FROM finance.payout WHERE shop_id=$1`,
      params,
    )) as Array<{
      pendingPayoutAmount: number;
      heldPayoutAmount: number;
      paidPayoutAmount: number;
    }>;
    return row;
  }

  private schedule(
    frequency: PayoutScheduleFrequency | undefined,
    updatedAt: Date | undefined,
  ): PayoutScheduleRow {
    const effective = frequency ?? DEFAULT_PAYOUT_FREQUENCY;
    return {
      frequency: effective,
      isDefault: !frequency,
      nextPayoutDate: nextPayoutDate(effective),
      updatedAt: updatedAt ?? null,
    };
  }

  // Gateway do'konni doim tokendan beradi; bo'sh kelsa — bu xato, jim natija emas.
  private assertShop(shopId: string) {
    if (!shopId) throw new BadRequestException('shopId majburiy');
  }
}
