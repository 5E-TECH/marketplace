import { of, throwError } from 'rxjs';
import {
  CATALOG_DISPLAY_LOOKUP,
  WholesalerSettlementDto,
  WholesalerSettlementStatus,
} from '@app/common';
import { inspectPdf } from '@app/common/pdf/pdf-inspect';
import { DataSource } from 'typeorm';
import { LedgerService } from './ledger.service';
import { SettlementService } from './settlement.service';

/** BE-33: akt-sverka PDF — Unicode shrift; tomonlar (nomi, STIR, shartnoma) va tovar nomi (QA 2026-11-27). */
describe('SettlementService.actPdf', () => {
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
  const PAYER = {
    returnWindowDays: 10,
    payerName: 'Elchi Marketplace MChJ',
    payerTin: '305000000',
    payerAccount: '20208000900100000001',
    payerMfo: '01158',
    payerBankName: 'Kapitalbank',
    paymentPurposeCode: '00668',
  };
  const catalog = (
    details: unknown[],
    display: { shops: unknown[]; products: unknown[] },
  ) => ({
    send: jest.fn((pattern: { cmd: string }) =>
      of(
        pattern.cmd === CATALOG_DISPLAY_LOOKUP
          ? { ...display, variants: [] }
          : details,
      ),
    ),
  });
  const service = (
    cat: unknown,
    payer: Record<string, unknown> = PAYER,
    /** `finance.text_setting` dagi akt sanasida amalda bo‘lgan qatorlar. */
    dated: Array<{ key: string; value: string }> = [],
  ) => {
    const svc = new SettlementService(
      { query: jest.fn().mockResolvedValue(dated) } as unknown as DataSource,
      {} as LedgerService,
      cat as never,
    );
    jest.spyOn(svc, 'get').mockResolvedValue(settlement);
    jest.spyOn(svc, 'settings').mockResolvedValue(payer as never);
    return svc;
  };

  it('DejaVu shrift; tomonlar, shartnoma va tovar nomi bilan (`#ID` yo‘q)', async () => {
    const svc = service(
      catalog(
        [
          {
            id: '501',
            name: 'Namuna Savdo MChJ',
            tin: '307418562',
            bankName: 'Namuna Bank ATB',
            bankAccount: '20208000405128739001',
            bankMfo: '00873',
            contractNumber: 'K-12',
            contractDate: '2026-12-28',
          },
        ],
        {
          shops: [{ id: '501', name: 'Namuna Savdo MChJ' }],
          products: [
            {
              id: '9',
              name: 'Simsiz quloqchin',
              imageUrl: null,
              expiryTracked: false,
            },
          ],
        },
      ),
    );
    const file = await svc.actPdf({ id: '7' });
    const { text, fonts } = inspectPdf(Buffer.from(file.base64, 'base64'));

    expect(fonts).toEqual([
      expect.stringMatching(/^[A-Z]{6}\+DejaVuSansCondensed$/),
    ]);
    expect(text).toContain('AKT-SVERKA AS-000007');
    expect(text).toContain('Davr: 04.01.2027 — 10.01.2027');
    expect(text).toContain(
      'Komissioner (platforma): Elchi Marketplace MChJ, STIR 305000000',
    );
    expect(text).toContain(
      'Komitent (optovik): Namuna Savdo MChJ, STIR 307418562',
    );
    expect(text).toContain('Asos: komissiya shartnomasi № K-12, 28.12.2026');
    expect(text).toContain('Holat: To‘landi (12.01.2027)');
    expect(text).toContain(
      'mp-order:42 | Simsiz quloqchin | 2 | 05.01.2027 | 1 250 000',
    );
    expect(text).toContain('O‘tkaziladi: 1 200 000 so‘m');
    expect(text).not.toContain('#501');
    expect(text).not.toContain('BE-07');
  });

  it('rekvizit yo‘q — PDF baribir chiqadi: «—» (optovik ham yuklaydi — ichki ko‘rsatma yo‘q), optovik nomi do‘kondan, tovar `#ID`', async () => {
    const svc = service(
      catalog([], {
        shops: [{ id: '501', name: 'Namuna Savdo MChJ' }],
        products: [],
      }),
      {
        returnWindowDays: 10,
        payerName: null,
        payerTin: null,
        payerAccount: null,
        payerMfo: null,
        payerBankName: null,
        paymentPurposeCode: null,
      },
    );
    const { text } = inspectPdf(
      Buffer.from((await svc.actPdf({ id: '7' })).base64, 'base64'),
    );
    expect(text).toContain('Komissioner (platforma): —, STIR —');
    expect(text).not.toContain('sozlanmagan');
    expect(text).not.toContain('EQ-05');
    expect(text).toContain('Komitent (optovik): Namuna Savdo MChJ, STIR —');
    expect(text).toContain('Asos: komissiya shartnomasi № —');
    expect(text).toContain('mp-order:42 | mahsulot #9 | 2');
  });

  it('katalog javob bermasa yoki ulanmagan — PDF «—» bilan chiqadi (gateway chegarasigacha kutmaydi)', async () => {
    const down = {
      send: jest.fn(() => throwError(() => new Error('katalog yo‘q'))),
    };
    for (const cat of [down, undefined]) {
      const { text } = inspectPdf(
        Buffer.from((await service(cat).actPdf({ id: '7' })).base64, 'base64'),
      );
      expect(text).toContain('Komitent (optovik): —, STIR —');
      expect(text).toContain('mp-order:42 | mahsulot #9 | 2');
      expect(text).not.toContain('katalogda topilmadi');
    }
  });

  it('platforma rekvizitlari — akt sanasidagi sozlamadan (keyin o‘zgartirilsa eski akt o‘zgarmaydi)', async () => {
    const svc = service(
      catalog([], { shops: [], products: [] }),
      { ...PAYER, payerName: 'Yangi nom MChJ', payerTin: '309999999' },
      [{ key: 'payer_name', value: 'Elchi Marketplace MChJ' }],
    );
    const { text } = inspectPdf(
      Buffer.from((await svc.actPdf({ id: '7' })).base64, 'base64'),
    );
    // nom — akt sanasidagisi; STIR u paytda kiritilmagan — joriy
    expect(text).toContain(
      'Komissioner (platforma): Elchi Marketplace MChJ, STIR 309999999',
    );
  });
});
