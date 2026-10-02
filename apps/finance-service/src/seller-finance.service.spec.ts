import { BadRequestException } from '@nestjs/common';
import { PayoutScheduleFrequency } from '@app/common';
import { SellerFinanceService } from './seller-finance.service';
import { nextPayoutDate } from './payout-schedule.util';

describe('SellerFinanceService', () => {
  const cod = {
    settlementsCount: 2,
    expectedCodAmount: 2000,
    collectedCodAmount: 2000,
    difference: 0,
    expectedCommission: 200,
    nettedCommission: 50,
    outstandingCommission: 150,
  };

  function setup(schedule?: { frequency: PayoutScheduleFrequency }) {
    const query = jest.fn(async (sql: string, params: unknown[] = []) => {
      if (sql.includes('FROM finance.payout_schedule'))
        return schedule ? [{ ...schedule, updatedAt: new Date(0) }] : [];
      if (sql.includes('INSERT INTO finance.payout_schedule'))
        return [{ frequency: params[1], updatedAt: new Date(0) }];
      if (sql.includes('FROM finance.payout WHERE shop_id=$1'))
        return [
          {
            pendingPayoutAmount: 450,
            heldPayoutAmount: 30,
            paidPayoutAmount: 900,
          },
        ];
      return [];
    });
    const finance = {
      currentBalance: jest.fn().mockResolvedValue(-150),
      reconciliationReport: jest.fn().mockResolvedValue(cod),
    };
    return {
      service: new SellerFinanceService({ query } as never, finance as never),
      query,
      finance,
    };
  }

  it('summary: balans, payout jamlari, COD hisoboti va keyingi to‘lov kuni', async () => {
    const { service, finance, query } = setup({
      frequency: PayoutScheduleFrequency.DAILY,
    });

    const summary = await service.summary('7', {
      dateFrom: '2026-09-01',
      dateTo: '2026-09-30',
    });

    expect(summary).toEqual({
      shopId: '7',
      balance: -150,
      pendingPayoutAmount: 450,
      heldPayoutAmount: 30,
      paidPayoutAmount: 900,
      cod,
      payoutSchedule: PayoutScheduleFrequency.DAILY,
      nextPayoutDate: nextPayoutDate(PayoutScheduleFrequency.DAILY),
    });
    expect(finance.currentBalance).toHaveBeenCalledWith('7');
    // COD hisoboti — admin /reports bilan bir xil, faqat shu do'kon.
    expect(finance.reconciliationReport).toHaveBeenCalledWith({
      shopId: '7',
      dateFrom: '2026-09-01',
      dateTo: '2026-09-30',
    });
    // Davr faqat to'langan payout'larga (paid_at) qo'llanadi.
    const [sql, params] = query.mock.calls.find(([text]) =>
      text.includes('FROM finance.payout WHERE shop_id=$1'),
    )!;
    expect(sql).toContain(
      `status='PAID' AND paid_at >= $2 AND paid_at < ($3::date + INTERVAL '1 day')`,
    );
    expect(params).toEqual(['7', '2026-09-01', '2026-09-30']);
  });

  it('jadval tanlanmagan bo‘lsa WEEKLY default qaytadi', async () => {
    const { service } = setup();
    await expect(service.getSchedule('7')).resolves.toEqual({
      frequency: PayoutScheduleFrequency.WEEKLY,
      isDefault: true,
      nextPayoutDate: nextPayoutDate(PayoutScheduleFrequency.WEEKLY),
      updatedAt: null,
    });
  });

  it('jadval upsert qilinadi (har do‘konga bitta)', async () => {
    const { service, query } = setup();
    await expect(
      service.updateSchedule('7', PayoutScheduleFrequency.MONTHLY),
    ).resolves.toMatchObject({
      frequency: PayoutScheduleFrequency.MONTHLY,
      isDefault: false,
      nextPayoutDate: nextPayoutDate(PayoutScheduleFrequency.MONTHLY),
    });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('ON CONFLICT (shop_id)');
    expect(params).toEqual(['7', 'MONTHLY']);
  });

  it('noma’lum chastota va bo‘sh shopId rad etiladi', async () => {
    const { service, query } = setup();
    await expect(
      service.updateSchedule('7', 'YEARLY' as PayoutScheduleFrequency),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.summary('')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(query).not.toHaveBeenCalled();
  });
});
