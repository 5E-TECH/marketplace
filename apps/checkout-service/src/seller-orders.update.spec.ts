import { of } from 'rxjs';
import { BadRequestException, NotFoundException } from '@nestjs/common';
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
