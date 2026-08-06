import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SellerOrdersService } from './seller-orders.service';

describe('SellerOrdersService.updateStatus (C1.38 — operator scope)', () => {
  it('TC3: o‘z do‘koni buyurtmasi -> status yangilanadi (shop_id scope)', async () => {
    const query = jest.fn((_sql: string, _params: unknown[]) =>
      Promise.resolve([{ id: '7', status: 'SHIPMENT_CREATED' }]),
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
