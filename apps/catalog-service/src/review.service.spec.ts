import { ConflictException } from '@nestjs/common';
import { of } from 'rxjs';
import { ReviewService } from './review.service';

describe('ReviewService (C4.1)', () => {
  const eligibility = {
    orderItemId: '31',
    customerId: '42',
    productId: '12',
    shopId: '5',
    sellerOrderId: '9',
    status: 'DELIVERED',
  };

  function setup(duplicate = false) {
    const queries: string[] = [];
    const manager = {
      query: jest.fn(async (sql: string) => {
        queries.push(sql);
        if (sql.includes('SELECT id FROM catalog.product'))
          return [{ id: '12' }];
        if (sql.includes('INSERT INTO catalog.review')) {
          if (duplicate)
            throw Object.assign(new Error('duplicate'), { code: '23505' });
          return [{ id: '1', userId: '42', rating: 5, productId: '12' }];
        }
        return [];
      }),
    };
    const dataSource = {
      transaction: jest.fn(async (run) => run(manager)),
      query: jest.fn(),
    };
    const checkout = { send: jest.fn(() => of(eligibility)) };
    return {
      service: new ReviewService(dataSource as never, checkout as never),
      checkout,
      queries,
    };
  }

  it('TC2: review yaratib product va shop ratingni qayta hisoblaydi', async () => {
    const { service, checkout, queries } = setup();
    await expect(
      service.create('42', '12', {
        orderItemId: '31',
        rating: 5,
        comment: 'Zo‘r',
      }),
    ).resolves.toMatchObject({ id: '1', rating: 5 });
    expect(checkout.send).toHaveBeenCalledWith(
      { cmd: 'checkout.review.verify' },
      { customerId: '42', orderItemId: '31', productId: '12' },
    );
    expect(queries.some((sql) => sql.includes('UPDATE catalog.product'))).toBe(
      true,
    );
    expect(queries.some((sql) => sql.includes('UPDATE catalog.shop'))).toBe(
      true,
    );
  });

  it('TC3: bir order itemga ikkinchi reviewni rad etadi', async () => {
    const { service } = setup(true);
    await expect(
      service.create('42', '12', { orderItemId: '31', rating: 4 }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
