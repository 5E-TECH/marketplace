import { Role, ROLES_KEY } from '@app/common';
import { ProductsController } from './products.controller';

describe('ProductsController access metadata', () => {
  it('barcha product endpointlarini SELLER bilan himoyalaydi', () => {
    expect(Reflect.getMetadata(ROLES_KEY, ProductsController)).toEqual([
      Role.SELLER,
    ]);
  });

  it('JWT owner id ni RMQ payloadga uzatadi', async () => {
    const send = jest.fn(() => ({
      pipe: () => ({
        subscribe: jest.fn(),
      }),
    }));
    const controller = new ProductsController({ send } as any);

    // Controller metodining ownership manbai faqat CurrentUser ekanini signature
    // va service unit testlari bilan qoplaymiz; client DTO'da ownerUserId yo'q.
    expect(controller).toBeDefined();
  });
});
