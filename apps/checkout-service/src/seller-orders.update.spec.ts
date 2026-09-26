import { of, throwError } from 'rxjs';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { SellerOrdersService } from './seller-orders.service';

describe('SellerOrdersService.updateStatus (C1.38 — operator scope)', () => {
  it('TC3: o‘z do‘koni buyurtmasi -> status yangilanadi (shop_id scope)', async () => {
    // `[[qator], soni]` ATAYLAB — Postgres drayveri `UPDATE ... RETURNING`
    // uchun aynan shunday qaytaradi. Avval bu mock oddiy massiv qaytarardi,
    // ya'ni haqiqatdan soddaroq edi, va shu sabab jonli javobdagi
    // `{"id":"undefined"}` nuqsonini o'tkazib yuborgandi.
    const query = jest.fn((_sql: string, _params: unknown[]) =>
      Promise.resolve([[{ id: '7', status: 'SHIPMENT_CREATED' }], 1]),
    );
    const svc = new SellerOrdersService({ query } as never);

    const res = await svc.updateStatus('5', '7', 'SHIPMENT_CREATED');

    expect(res).toEqual({ id: '7', status: 'SHIPMENT_CREATED' });
    // scope: parametrlarda shop_id ('5') bor
    expect(query.mock.calls[0][1]).toEqual(['SHIPMENT_CREATED', '7', '5']);
    expect(String(query.mock.calls[0][0])).toContain('shop_id = $3');
  });

  it('TC4: boshqa do‘kon buyurtmasi -> 404 (topilmadi/ruxsat yo‘q)', async () => {
    const query = jest.fn(() => Promise.resolve([])); // shop mos emas -> 0 qator
    const svc = new SellerOrdersService({ query } as never);
    await expect(
      svc.updateStatus('5', '7', 'DELIVERED'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('noto‘g‘ri status -> 400', async () => {
    const svc = new SellerOrdersService({ query: jest.fn() } as never);
    await expect(svc.updateStatus('5', '7', 'XXX')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('SellerOrdersService.createShipment (qr_code_token)', () => {
  /**
   * Pochta posilkani `qr_code_token` bo'yicha skanerlab qabul qiladi va
   * yorliqdagi QR ichiga ham shu yoziladi (C1.45). Elchi uni javobda
   * qaytaradi, lekin avval biz uni tashlab yuborardik — natijada yorliqni
   * chop etib bo'lmasdi.
   */
  it('Elchi qaytargan qr_code_token bazaga yoziladi', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const integration = {
      send: jest.fn((_pattern: unknown, _payload: unknown) =>
        of({
          shipment_id: '1251131',
          qr_code_token: '3e3a70f78d54064348bde43a',
          to_be_paid: 45000,
        }),
      ),
    };
    const service = new SellerOrdersService(
      { query } as never,
      integration as never,
    );
    jest.spyOn(service, 'getSellerOrder').mockResolvedValue({
      id: '9',
      shopId: '4',
      status: 'CONFIRMED',
      codAmount: 45000,
      buyerName: 'Nodira',
      deliveryAddress: 'Toshkent',
      regionId: '1',
      districtId: '11',
      whereDeliver: 'ADDRESS',
    } as never);
    jest
      .spyOn(service, 'getItems')
      .mockResolvedValue([
        { productName: 'Yorliq sinov mahsuloti', quantity: 1 },
      ] as never);

    await service.createShipment('4', '9', '+998901234567');

    const update = query.mock.calls.find((call) =>
      String(call[0]).includes('qr_code_token=$3'),
    );
    expect(update).toBeDefined();
    expect((update as unknown[])[1]).toEqual(
      expect.arrayContaining(['3e3a70f78d54064348bde43a', 45000]),
    );
    // `shopId` Elchi'ga emas, integratsiyaga uzatiladi (o'sha yerda market
    // id'siga o'giriladi) — C1.45 bilan bir xil zanjir.
    expect(integration.send.mock.calls[0][1]).toEqual(
      expect.objectContaining({ shopId: '4' }),
    );
  });
});

/** Label testlari uchun servis: catalog (do'kon nomi) va integratsiya (geo, token). */
function labelService(
  options: {
    query?: jest.Mock;
    shipment?: Record<string, unknown> | Error;
  } = {},
) {
  const query = options.query ?? jest.fn().mockResolvedValue([]);
  const integration = {
    send: jest.fn((pattern: { cmd: string }, payload: any) => {
      switch (pattern.cmd) {
        case 'integration.regions.list':
          return of([{ id: '1', name: 'Toshkent shahri' }]);
        case 'integration.districts.list':
          return of([
            { id: '11', regionId: payload.regionId, name: 'Chilonzor' },
          ]);
        case 'integration.shipment.get':
          return options.shipment instanceof Error
            ? throwError(() => options.shipment)
            : of(options.shipment ?? { shipment_id: payload.shipmentId });
        default:
          return of(null);
      }
    }),
  };
  const catalog = {
    send: jest.fn(() => of({ id: '4', name: 'Nodira Butik' })),
  };
  const service = new SellerOrdersService(
    { query } as never,
    integration as never,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    catalog as never,
  );
  return { service, query, integration, catalog };
}

const labelOrder = {
  id: '9',
  salesOrderId: '5',
  shopId: '4',
  elchiShipmentId: '1251131',
  qrCodeToken: '3e3a70f78d54064348bde43a',
  buyerName: 'Nodira',
  deliveryAddress: 'Chilonzor 9-kvartal, 12-uy\n+998901234567',
  regionId: '1',
  districtId: '11',
  codAmount: 45000,
  elchiToBePaid: null,
};

describe('SellerOrdersService.getShippingLabelData (C1.45)', () => {
  it('shipment, QR, jo‘natuvchi, viloyat/tuman, manzil, COD va itemlarni tayyorlaydi', async () => {
    const { service } = labelService();
    jest
      .spyOn(service, 'getSellerOrder')
      .mockResolvedValue(labelOrder as never);
    jest
      .spyOn(service, 'getItems')
      .mockResolvedValue([{ productName: 'Telefon', quantity: 2 }] as never);

    await expect(service.getShippingLabelData('4', '9')).resolves.toEqual({
      sellerOrderId: '9',
      salesOrderId: '5',
      shipmentId: '1251131',
      qrCodeToken: '3e3a70f78d54064348bde43a',
      senderName: 'Nodira Butik',
      buyerName: 'Nodira',
      buyerPhone: '+998901234567',
      regionName: 'Toshkent shahri',
      districtName: 'Chilonzor',
      deliveryAddress: 'Chilonzor 9-kvartal, 12-uy',
      codAmount: 45000,
      items: [{ productName: 'Telefon', quantity: 2 }],
    });
    expect(service.getSellerOrder).toHaveBeenCalledWith('4', '9');
    expect(service.getItems).toHaveBeenCalledWith('4', '9');
  });

  it('COD: Elchi to_be_paid bor bo‘lsa kuryer oladigan shu summa chiqadi', async () => {
    const { service } = labelService();
    jest.spyOn(service, 'getSellerOrder').mockResolvedValue({
      ...labelOrder,
      codAmount: 50000,
      elchiToBePaid: 45000,
    } as never);
    jest.spyOn(service, 'getItems').mockResolvedValue([] as never);

    await expect(service.getShippingLabelData('4', '9')).resolves.toMatchObject(
      { codAmount: 45000 },
    );
  });

  it('token yo‘q, posilka bor — tokenni Elchi’dan olib saqlaydi va yorliq chiqadi', async () => {
    const { service, query, integration } = labelService({
      shipment: {
        shipment_id: '1251128',
        qr_code_token: 'a1b2c3d4e5f60718293a4b5c',
        to_be_paid: 38000,
      },
    });
    jest.spyOn(service, 'getSellerOrder').mockResolvedValue({
      ...labelOrder,
      id: '7',
      elchiShipmentId: '1251128',
      qrCodeToken: null,
    } as never);
    jest.spyOn(service, 'getItems').mockResolvedValue([] as never);

    const label = await service.getShippingLabelData('4', '7');

    expect(label.qrCodeToken).toBe('a1b2c3d4e5f60718293a4b5c');
    expect(label.codAmount).toBe(38000);
    expect(integration.send).toHaveBeenCalledWith(
      { cmd: 'integration.shipment.get' },
      { shipmentId: '1251128' },
    );
    const update = query.mock.calls.find((call) =>
      String(call[0]).includes('SET qr_code_token=$1'),
    );
    // Faqat token hali NULL bo'lsa yoziladi — parallel so'rov ustiga yozmaydi.
    expect(String(update?.[0])).toContain('qr_code_token IS NULL');
    expect(update?.[1]).toEqual(['a1b2c3d4e5f60718293a4b5c', 38000, '7']);
  });

  it('Elchi’da ham token yo‘q yoki Elchi javob bermasa — 409, bazaga yozilmaydi', async () => {
    for (const shipment of [
      { shipment_id: '1251128' },
      new Error('Elchi API GET → 503'),
    ]) {
      const { service, query } = labelService({ shipment });
      jest.spyOn(service, 'getSellerOrder').mockResolvedValue({
        ...labelOrder,
        qrCodeToken: null,
      } as never);

      await expect(
        service.getShippingLabelData('4', '9'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(query).not.toHaveBeenCalled();
    }
  });

  it('shipment bo‘lmasa yorliqni 409 bilan rad etadi (Elchi’ga so‘rov ketmaydi)', async () => {
    const { service, integration } = labelService();
    jest.spyOn(service, 'getSellerOrder').mockResolvedValue({
      id: '9',
      elchiShipmentId: null,
      qrCodeToken: null,
    } as never);

    await expect(service.getShippingLabelData('4', '9')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(integration.send).not.toHaveBeenCalled();
  });

  it('begona do‘kon buyurtmasi uchun 404 qaytaradi', async () => {
    const service = new SellerOrdersService({
      query: jest.fn(() => Promise.resolve([])),
    } as never);

    await expect(
      service.getShippingLabelData('99', '9'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('SellerOrdersService yorliq partiyasi va admin id fazosi (C1.45)', () => {
  it('bitta yomon buyurtma partiyani yiqitmaydi — u skipped ga tushadi', async () => {
    const { service } = labelService();
    jest
      .spyOn(service, 'getShippingLabelData')
      .mockImplementation(async (_shopId, id) => {
        if (id === '7')
          throw new ConflictException('Elchi shipment QR tokeni mavjud emas');
        return { sellerOrderId: id } as never;
      });

    const result = await service.collectShippingLabels([
      { shopId: '4', sellerOrderId: '9', orderId: '9' },
      { shopId: '4', sellerOrderId: '7', orderId: '7' },
    ]);

    expect(result.labels).toEqual([{ sellerOrderId: '9' }]);
    expect(result.skipped).toEqual([
      { orderId: '7', reason: 'Elchi shipment QR tokeni mavjud emas' },
    ]);
  });

  /**
   * Prod holati: sales_order 14 da ikki do'kon (seller-order 14 va 15),
   * ketma-ketliklar ajralgan. Avval admin yorlig'i sales_order id'sini
   * seller-order id deb o'qirdi va BOSHQA xaridor yorlig'ini chiqarardi.
   */
  it('admin: sales_order id bo‘yicha buyurtmaning HAMMA posilkalari olinadi', async () => {
    const query = jest.fn().mockResolvedValue([
      { sellerOrderId: '14', orderId: '14', shopId: '5' },
      { sellerOrderId: '15', orderId: '14', shopId: '7' },
      { sellerOrderId: '16', orderId: '15', shopId: '5' },
    ]);
    const { service } = labelService({ query });

    const result = await service.adminShippingLabelTargets([
      '15',
      '14',
      '99',
      'abc',
    ]);

    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('WHERE sales_order_id = ANY($1::bigint[])');
    // raqam bo'lmagan id bazaga ketmaydi (bigint cast butun partiyani yiqitardi)
    expect(params).toEqual([['15', '14', '99']]);
    // So'ralgan tartibda: avval 15-buyurtma, keyin 14 ning ikkala posilkasi.
    expect(result.targets).toEqual([
      { sellerOrderId: '16', orderId: '15', shopId: '5' },
      { sellerOrderId: '14', orderId: '14', shopId: '5' },
      { sellerOrderId: '15', orderId: '14', shopId: '7' },
    ]);
    expect(result.missing).toEqual([
      { orderId: '99', reason: 'Buyurtma topilmadi' },
      { orderId: 'abc', reason: 'Buyurtma topilmadi' },
    ]);
  });

  it('admin bitta posilka: seller-order shu buyurtmaga tegishli bo‘lishi shart', async () => {
    const query = jest.fn().mockResolvedValueOnce([{ shopId: '7' }]);
    const { service } = labelService({ query });
    jest.spyOn(service, 'getShippingLabelData').mockResolvedValue({
      sellerOrderId: '15',
    } as never);

    await service.getShippingLabelDataForAdmin('14', '15');

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('WHERE id=$1 AND sales_order_id=$2'),
      ['15', '14'],
    );
    expect(service.getShippingLabelData).toHaveBeenCalledWith('7', '15');

    query.mockResolvedValueOnce([]);
    await expect(
      service.getShippingLabelDataForAdmin('15', '14'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('SellerOrdersService.syncShipmentTokens (C1.45 backfill)', () => {
  function syncService(rows: unknown[], elchi: Record<string, unknown>) {
    const query = jest.fn((sql: string, _params?: unknown[]) =>
      Promise.resolve(sql.includes('LIMIT $2') ? rows : []),
    );
    const integration = {
      send: jest.fn((_pattern, payload: { shipmentId: string }) => {
        const value = elchi[payload.shipmentId];
        return value instanceof Error
          ? throwError(() => value)
          : of(value ?? { shipment_id: payload.shipmentId });
      }),
    };
    const service = new SellerOrdersService(
      { query } as never,
      integration as never,
    );
    return { service, query };
  }

  const rows = [
    // xaridor oqimi tokenni saqlamagan satr
    { id: '7', shipmentId: '1251128', qrCodeToken: null, toBePaid: null },
    // qo'lda yozilgan soxta test tokeni
    {
      id: '9',
      shipmentId: '1251131',
      qrCodeToken: 'ELCHI-TEST-QR-TOKEN-12345',
      toBePaid: null,
    },
    // allaqachon to'g'ri
    {
      id: '11',
      shipmentId: '1251134',
      qrCodeToken: 'bbbbbbbbbbbbbbbbbbbbbbbb',
      toBePaid: '30000.00',
    },
    // Elchi javob bermadi
    { id: '14', shipmentId: '1251146', qrCodeToken: null, toBePaid: null },
  ];
  const elchi = {
    '1251128': {
      shipment_id: '1251128',
      qr_code_token: 'aaaaaaaaaaaaaaaaaaaaaaaa',
      to_be_paid: 38000,
    },
    '1251131': {
      shipment_id: '1251131',
      qr_code_token: '3e3a70f78d54064348bde43a',
      to_be_paid: 45000,
    },
    '1251134': {
      shipment_id: '1251134',
      qr_code_token: 'bbbbbbbbbbbbbbbbbbbbbbbb',
      to_be_paid: 30000,
    },
    '1251146': new Error('Elchi API GET → 503'),
  };

  it('NULL va soxta tokenlarni Elchi’dagisi bilan almashtiradi', async () => {
    const { service, query } = syncService(rows, elchi);

    const result = await service.syncShipmentTokens({ limit: 20 });

    expect(
      result.items.map((item) => [item.sellerOrderId, item.action]),
    ).toEqual([
      ['7', 'updated'],
      ['9', 'updated'],
      ['11', 'unchanged'],
      ['14', 'failed'],
    ]);
    const updates = query.mock.calls.filter((call) =>
      String(call[0]).includes('SET qr_code_token=$1'),
    );
    expect(updates.map((call) => call[1])).toEqual([
      ['aaaaaaaaaaaaaaaaaaaaaaaa', 38000, '7'],
      ['3e3a70f78d54064348bde43a', 45000, '9'],
    ]);
    // limit (20) to'lmadi — boshqa satr yo'q.
    expect(result.nextAfterId).toBeNull();
  });

  it('dryRun hech narsa yozmaydi, kursor keyingi bo‘lakni ko‘rsatadi', async () => {
    const { service, query } = syncService(rows, elchi);

    const result = await service.syncShipmentTokens({
      afterId: '6',
      limit: 4,
      dryRun: true,
    });

    expect(result.dryRun).toBe(true);
    expect(
      query.mock.calls.some((call) => String(call[0]).includes('UPDATE')),
    ).toBe(false);
    expect(query.mock.calls[0][1]).toEqual(['6', 4]);
    expect(result.nextAfterId).toBe('14');
  });
});
