import { IS_PUBLIC_KEY } from '@app/common';
import { StorefrontController } from './storefront.controller';
import { of } from 'rxjs';

describe('StorefrontController', () => {
  it('barcha storefront endpointlari public', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, StorefrontController)).toBe(true);
  });

  it('C6.6: featured shop so‘rovini catalogga uzatadi', async () => {
    const send = jest.fn(() => of([{ id: '9', isFeatured: true }]));
    const controller = new StorefrontController({ send } as never);

    await expect(controller.featuredShops()).resolves.toEqual([
      { id: '9', isFeatured: true },
    ]);
    expect(send).toHaveBeenCalledWith({ cmd: 'storefront.shops.featured' }, {});
  });
});
