import {
  WholesalerSettlementDto,
  WholesalerSettlementStatus,
} from '@app/common';
import { inspectPdf } from '@app/common/pdf/pdf-inspect';
import { DataSource } from 'typeorm';
import { LedgerService } from './ledger.service';
import { SettlementService } from './settlement.service';

describe('SettlementService.actPdf — Unicode shrift', () => {
  it('akt-sverka DejaVu bilan yoziladi: ‘ va — o‘qiladi, Helvetica yo‘q', async () => {
    const svc = new SettlementService({} as DataSource, {} as LedgerService);
    const settlement: WholesalerSettlementDto = {
      id: '7',
      number: 'AS-000007',
      wholesalerId: '501',
      periodStart: '2027-01-04',
      periodEnd: '2027-01-10',
      returnWindowDays: 10,
      status: WholesalerSettlementStatus.PAID,
      totalAmount: 1_250_000,
      exportedTotal: 1_200_000,
      debtDeducted: 50_000,
      exportedAt: new Date('2027-01-11T05:00:00.000Z'),
      itemsCount: 1,
      items: [
        {
          orderId: 'mp-order:42',
          productId: '9',
          quantity: 2,
          amount: 1_250_000,
          deliveredAt: new Date('2027-01-05T09:00:00.000Z'),
        },
      ],
      createdAt: new Date('2027-01-11T04:00:00.000Z'),
      paidAt: new Date('2027-01-12T06:00:00.000Z'),
      paidBy: '3',
    };
    jest.spyOn(svc, 'get').mockResolvedValue(settlement);

    const file = await svc.actPdf({ id: '7' });
    const { text, fonts } = inspectPdf(Buffer.from(file.base64, 'base64'));

    expect(fonts).toEqual([
      expect.stringMatching(/^[A-Z]{6}\+DejaVuSansCondensed$/),
    ]);
    expect(text).toContain('AKT-SVERKA AS-000007');
    expect(text).toContain('Davr: 2027-01-04 — 2027-01-10');
    expect(text).toContain('Holat: To‘landi (2027-01-12)');
    expect(text).toContain('mp-order:42 | 9 | 2 | 2027-01-05 | 1 250 000');
    expect(text).toContain('O‘tkaziladi: 1 200 000 so‘m');
  });
});
