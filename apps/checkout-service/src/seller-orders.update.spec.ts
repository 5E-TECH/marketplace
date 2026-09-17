import { of } from 'rxjs';
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
      expect.arrayContaining(['3e3a70f78d54064348bde43a']),
    );
    // `shopId` Elchi'ga emas, integratsiyaga uzatiladi (o'sha yerda market
    // id'siga o'giriladi) — C1.45 bilan bir xil zanjir.
    expect(integration.send.mock.calls[0][1]).toEqual(
      expect.objectContaining({ shopId: '4' }),
    );
  });
});

describe('SellerOrdersService.getShippingLabelData (C1.45)', () => {
  it('shipment, QR, qabul qiluvchi, manzil, COD va itemlarni tayyorlaydi', async () => {
    const service = new SellerOrdersService({ query: jest.fn() } as never);
    jest.spyOn(service, 'getSellerOrder').mockResolvedValue({
      id: '9',
      salesOrderId: '5',
      elchiShipmentId: '1251131',
      qrCodeToken: '3e3a70f78d54064348bde43a',
      buyerName: 'Nodira',
      deliveryAddress: 'Toshkent, Chilonzor\n+998901234567',
      codAmount: 45000,
    } as never);
    jest
      .spyOn(service, 'getItems')
      .mockResolvedValue([{ productName: 'Telefon', quantity: 2 }] as never);

    await expect(service.getShippingLabelData('4', '9')).resolves.toEqual({
      sellerOrderId: '9',
      salesOrderId: '5',
      shipmentId: '1251131',
      qrCodeToken: '3e3a70f78d54064348bde43a',
      buyerName: 'Nodira',
      buyerPhone: '+998901234567',
      deliveryAddress: 'Toshkent, Chilonzor',
      codAmount: 45000,
      items: [{ productName: 'Telefon', quantity: 2 }],
    });
    expect(service.getSellerOrder).toHaveBeenCalledWith('4', '9');
    expect(service.getItems).toHaveBeenCalledWith('4', '9');
  });

  it('shipment yoki QR token bo‘lmasa yorliqni 409 bilan rad etadi', async () => {
    const service = new SellerOrdersService({ query: jest.fn() } as never);
    jest.spyOn(service, 'getSellerOrder').mockResolvedValue({
      id: '9',
      elchiShipmentId: null,
      qrCodeToken: null,
    } as never);

    await expect(service.getShippingLabelData('4', '9')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('begona do‘kon buyurtmasi uchun 404 qaytaradi', async () => {
    const service = new SellerOrdersService({
      query: jest.fn(() => Promise.resolve([])),
    } as never);

    await expect(
      service.getShippingLabelData('99', '9'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('TC4: admin seller-order shopini topib yorliq ma’lumotini oladi', async () => {
    const query = jest.fn(() => Promise.resolve([{ shopId: '4' }]));
    const service = new SellerOrdersService({ query } as never);
    jest.spyOn(service, 'getShippingLabelData').mockResolvedValue({
      sellerOrderId: '9',
    } as never);

    await service.getShippingLabelDataForAdmin('9');

    expect(query).toHaveBeenCalledWith(expect.stringContaining('shop_id'), [
      '9',
    ]);
    expect(service.getShippingLabelData).toHaveBeenCalledWith('4', '9');
  });
});
