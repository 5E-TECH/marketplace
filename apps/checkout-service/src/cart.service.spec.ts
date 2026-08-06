import { CartService } from './cart.service';
import { Cart } from './entities/cart.entity';

describe('CartService', () => {
  let carts: any[];
  let items: any[];
  let service: CartService;

  beforeEach(() => {
    carts = [];
    items = [];
    let cartSequence = 0;
    let itemSequence = 0;
    const repository = (entity: unknown) => {
      const rows = entity === Cart ? carts : items;
      return {
        create: (value: any) => ({ ...value }),
        save: async (value: any) => {
          if (!value.id)
            value.id = String(
              entity === Cart ? ++cartSequence : ++itemSequence,
            );
          const index = rows.findIndex((row) => row.id === value.id);
          if (index < 0) rows.push(value);
          else rows[index] = value;
          return value;
        },
        findOne: async ({ where }: any) => {
          const row = rows.find((candidate) =>
            Object.entries(where).every(
              (entry) => candidate[entry[0]] === entry[1],
            ),
          );
          if (!row) return null;
          return entity === Cart
            ? { ...row, items: items.filter((item) => item.cartId === row.id) }
            : row;
        },
        delete: async (where: any) => {
          const index = rows.findIndex((candidate) =>
            typeof where === 'string'
              ? candidate.id === where
              : Object.entries(where).every(
                  (entry) => candidate[entry[0]] === entry[1],
                ),
          );
          if (index < 0) return { affected: 0 };
          rows.splice(index, 1);
          return { affected: 1 };
        },
      };
    };
    const manager = { getRepository: jest.fn(repository) };
    const dataSource = {
      manager,
      transaction: jest.fn((run) => run(manager)),
    };
    service = new CartService(dataSource as never);
  });

  it('TC1: item qo‘shadi va catalog narxini snapshot qiladi', async () => {
    const result = await service.add(
      { sessionId: 'anon-1' },
      { productId: '10', variantId: '11', quantity: 2 },
      { productId: '10', variantId: '11', shopId: '7', unitPrice: 125000 },
    );

    expect(result.items[0]).toEqual(
      expect.objectContaining({
        quantity: 2,
        unitPriceSnapshot: 125000,
        lineTotal: 250000,
      }),
    );
    expect(result.totalAmount).toBe(250000);
  });

  it('TC2: quantityni yangilaydi va itemni o‘chiradi', async () => {
    const added = await service.add(
      { sessionId: 'anon-2' },
      { productId: '10', variantId: '11', quantity: 1 },
      { productId: '10', variantId: '11', shopId: '7', unitPrice: 100 },
    );
    const updated = await service.update(
      { sessionId: 'anon-2' },
      added.items[0].id,
      3,
    );
    expect(updated.totalQuantity).toBe(3);

    const removed = await service.remove(
      { sessionId: 'anon-2' },
      added.items[0].id,
    );
    expect(removed.items).toEqual([]);
  });

  it('TC3: anon savatni user savatiga merge qiladi va bir xil variant qty sini qo‘shadi', async () => {
    await service.add(
      { customerId: '99' },
      { productId: '10', variantId: '11', quantity: 2 },
      { productId: '10', variantId: '11', shopId: '7', unitPrice: 90 },
    );
    await service.add(
      { sessionId: 'anon-3' },
      { productId: '10', variantId: '11', quantity: 3 },
      { productId: '10', variantId: '11', shopId: '7', unitPrice: 100 },
    );

    const merged = await service.merge('99', 'anon-3');

    expect(merged.customerId).toBe('99');
    expect(merged.items).toHaveLength(1);
    expect(merged.items[0]).toEqual(
      expect.objectContaining({ quantity: 5, unitPriceSnapshot: 100 }),
    );
    expect(carts.find((cart) => cart.sessionId === 'anon-3')?.status).toBe(
      'converted',
    );
  });
});
