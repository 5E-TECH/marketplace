import { of, throwError } from 'rxjs';
import {
  FINANCE_SETTLEMENT_RPC,
  WHOLESALER_ATTENTION_RPC,
  WholesalerSettlementStatus,
} from '@app/common';
import { WholesalerAttentionService } from './wholesaler-attention.service';

/** BE-25 (FE-25): «Diqqat talab qiladi» va optovik aktlari — uch servisdan yig‘ish. */
describe('WholesalerAttentionService', () => {
  const variants = [
    {
      wholesalerId: '7',
      productId: '42',
      productName: 'Elektr choynak',
      variantId: '420',
      sku: 'CH-1',
      onSale: true,
    },
    {
      wholesalerId: '8',
      productId: '43',
      productName: 'Termos',
      variantId: '430',
      sku: 'TR-1',
      onSale: false,
    },
  ];
  const catalogReply = {
    wholesalers: [
      { id: '7', name: '«Toshkent Savdo» MChJ' },
      { id: '8', name: 'Namuna MChJ' },
    ],
    variants,
  };
  const client = (handler: (cmd: string, data: unknown) => unknown) => ({
    send: jest.fn((pattern: { cmd: string }, data: unknown) => {
      const reply = handler(pattern.cmd, data);
      return reply instanceof Error ? throwError(() => reply) : of(reply);
    }),
  });

  it('to‘rt tur ketma-ket, optovik nomi bilan; o‘chirilgan optovik yozuvi chiqmaydi', async () => {
    const catalog = client(() => catalogReply);
    const inventory = client(() => ({
      defectShipments: [
        {
          shipmentId: '14',
          wholesalerId: '7',
          code: 'PS-000014',
          productName: 'Bolalar termos shishasi',
          declared: 100,
          received: 100,
          defect: 2,
        },
        // optovik o‘chirilgan (katalogda yo‘q)
        {
          shipmentId: '15',
          wholesalerId: '99',
          code: 'PS-000015',
          productName: 'X',
          declared: 1,
          received: 0,
          defect: 0,
        },
      ],
      outOfStock: [
        {
          productId: '42',
          onHand: 3,
          reserved: 3,
          blocked: 0,
          incomingCode: 'PS-000016',
          incomingQty: 40,
        },
      ],
      defectByWholesaler: [
        {
          wholesalerId: '8',
          quantity: 3,
          fromReceiving: 2,
          receivingCodes: ['PS-000014'],
          fromReturns: 1,
          returnCodes: ['L-1031'],
        },
      ],
    }));
    const finance = client(() => [
      {
        id: '12',
        number: 'AS-000012',
        wholesalerId: '7',
        periodStart: '2027-01-04',
        periodEnd: '2027-01-10',
        amount: 280_000,
      },
    ]);
    const service = new WholesalerAttentionService(
      catalog as never,
      inventory as never,
      finance as never,
    );

    await expect(service.attention()).resolves.toEqual([
      {
        kind: 'SHIPMENT_DEFECT',
        id: 'defect-14',
        wholesalerId: '7',
        wholesalerName: '«Toshkent Savdo» MChJ',
        shipmentId: '14',
        shipmentCode: 'PS-000014',
        productName: 'Bolalar termos shishasi',
        declared: 100,
        received: 100,
        defect: 2,
      },
      {
        kind: 'OUT_OF_STOCK',
        id: 'stock-42',
        wholesalerId: '7',
        wholesalerName: '«Toshkent Savdo» MChJ',
        productId: '42',
        productName: 'Elektr choynak',
        onHand: 3,
        reserved: 3,
        blocked: 0,
        incomingCode: 'PS-000016',
        incomingQty: 40,
      },
      {
        kind: 'DEFECT_NOT_RETURNED',
        id: 'returns-8',
        wholesalerId: '8',
        wholesalerName: 'Namuna MChJ',
        quantity: 3,
        fromReceiving: 2,
        receivingCodes: ['PS-000014'],
        fromReturns: 1,
        returnCodes: ['L-1031'],
      },
      {
        kind: 'SETTLEMENT_READY',
        id: 'act-12',
        wholesalerId: '7',
        wholesalerName: '«Toshkent Savdo» MChJ',
        settlementId: '12',
        code: 'AS-000012',
        periodFrom: '2027-01-04',
        periodTo: '2027-01-10',
        amount: 280_000,
      },
    ]);
    // inventory catalog variantlari bilan so‘raladi
    expect(inventory.send).toHaveBeenCalledWith(
      { cmd: WHOLESALER_ATTENTION_RPC.INVENTORY_ATTENTION },
      { variants, wholesalerIds: ['7', '8'] },
    );
    expect(finance.send).toHaveBeenCalledWith(
      { cmd: WHOLESALER_ATTENTION_RPC.FINANCE_READY },
      {},
    );
  });

  it('biror servis javob bermasa — xato (yarim ro‘yxat «hammasi joyida» bo‘lib ko‘rinmasin)', async () => {
    const service = new WholesalerAttentionService(
      client(() => catalogReply) as never,
      client(() => ({ status: 500, message: 'x' }) as never) as never,
      client(() => new Error('finance yo‘q')) as never,
    );
    await expect(service.attention()).rejects.toBeDefined();
  });

  it('aktlar: ombor aktlari va akt-sverka birga, yangisi tepada; akt-sverka sarlavhasi summa bilan', async () => {
    const catalog = client((cmd) =>
      cmd === WHOLESALER_ATTENTION_RPC.CATALOG_VARIANTS
        ? {
            wholesalers: [catalogReply.wholesalers[0]],
            variants: [variants[0]],
          }
        : { id: '7' },
    );
    const inventory = client(() => [
      {
        id: 'BA-001031',
        kind: 'DEFECT',
        code: 'BA-001031',
        title: 'Elektr choynak · 1 dona · L-1031',
        at: '2027-01-14T05:30:00.000Z',
      },
      {
        id: 'PS-000014',
        kind: 'RECEIVING',
        code: 'PS-000014',
        title: 'Bolalar termos shishasi · farq: 2 brak',
        at: '2026-12-29T05:00:00.000Z',
      },
    ]);
    const finance = client(() => ({
      items: [
        {
          id: '12',
          number: 'AS-000012',
          wholesalerId: '7',
          periodStart: '2027-01-04',
          periodEnd: '2027-01-10',
          status: WholesalerSettlementStatus.READY,
          totalAmount: 1_250_000,
          exportedTotal: null,
          debtDeducted: 50_000,
          createdAt: '2027-01-11T04:00:00.000Z',
        },
      ],
      total: 1,
      page: 1,
      limit: 100,
      totalPages: 1,
    }));
    const service = new WholesalerAttentionService(
      catalog as never,
      inventory as never,
      finance as never,
    );
    const acts = await service.acts('7');
    expect(acts.map((a) => [a.kind, a.code, a.title, a.sentAt])).toEqual([
      ['DEFECT', 'BA-001031', 'Elektr choynak · 1 dona · L-1031', null],
      [
        'SETTLEMENT',
        'AS-000012',
        '04.01–10.01.2027 · o‘tkaziladi 1 200 000 so‘m',
        null,
      ],
      [
        'RECEIVING',
        'PS-000014',
        'Bolalar termos shishasi · farq: 2 brak',
        null,
      ],
    ]);
    expect(acts[0].at).toEqual(new Date('2027-01-14T05:30:00.000Z'));
    expect(catalog.send).toHaveBeenCalledWith(
      { cmd: 'catalog.wholesaler.admin-get' },
      { id: '7' },
    );
    expect(finance.send).toHaveBeenCalledWith(
      { cmd: FINANCE_SETTLEMENT_RPC.LIST },
      { query: { wholesalerId: '7', page: 1, limit: 100 } },
    );
  });

  it('aktlar: optovik topilmasa — 404 (ombor va moliya so‘ralmaydi)', async () => {
    const catalog = client(() => ({
      status: 404,
      message: 'Optovik topilmadi',
    }));
    catalog.send.mockImplementation(() =>
      throwError(() => ({ status: 404, message: 'Optovik topilmadi' })),
    );
    const inventory = client(() => []);
    const service = new WholesalerAttentionService(
      catalog as never,
      inventory as never,
      client(() => ({ items: [] })) as never,
    );
    await expect(service.acts('999')).rejects.toMatchObject({ status: 404 });
    expect(inventory.send).not.toHaveBeenCalled();
  });
});
