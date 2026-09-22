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
          // TypeORM mos keladigan BARCHA qatorni o'chiradi (cartId bo'yicha
          // savatni bo'shatish shunga tayanadi).
          const matches = rows.filter((candidate) =>
            typeof where === 'string'
              ? candidate.id === where
              : Object.entries(where).every(
                  (entry) => candidate[entry[0]] === entry[1],
                ),
          );
          for (const row of matches) rows.splice(rows.indexOf(row), 1);
          return { affected: matches.length };
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
      {
        productId: '10',
        variantId: '11',
        shopId: '7',
        unitPrice: 125000,
        productName: 'Smartfon X',
      },
    );

    expect(result.items[0]).toEqual(
      expect.objectContaining({
        quantity: 2,
        unitPriceSnapshot: 125000,
        lineTotal: 250000,
      }),
    );
    expect(result.totalAmount).toBe(250000);
    // Nom ham narx kabi suratga olinishi SHART: u buyurtmaga, undan esa
    // Elchi posilkasiga boradi. Elchi bo'sh nomni rad etadi.
    expect(items[0].productNameSnapshot).toBe('Smartfon X');
  });

  it('TC2: quantityni yangilaydi va itemni o‘chiradi', async () => {
    const added = await service.add(
      { sessionId: 'anon-2' },
      { productId: '10', variantId: '11', quantity: 1 },
      {
        productId: '10',
        variantId: '11',
        shopId: '7',
        unitPrice: 100,
        productName: 'Smartfon X',
      },
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
      {
        productId: '10',
        variantId: '11',
        shopId: '7',
        unitPrice: 90,
        productName: 'Smartfon X',
      },
    );
    await service.add(
      { sessionId: 'anon-3' },
      { productId: '10', variantId: '11', quantity: 3 },
      {
        productId: '10',
        variantId: '11',
        shopId: '7',
        unitPrice: 100,
        productName: 'Smartfon X',
      },
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

  it('savatni bo‘shatadi va bo‘sh savat qaytaradi', async () => {
    const owner = { sessionId: 'guest-1' };
    await service.add(owner, { productId: '1', variantId: '2', quantity: 3 }, {
      productId: '1',
      variantId: '2',
      shopId: '5',
      price: 1000,
      productName: 'Mahsulot',
    } as never);
    await service.add(owner, { productId: '9', variantId: '8', quantity: 1 }, {
      productId: '9',
      variantId: '8',
      shopId: '5',
      price: 2000,
      productName: 'Boshqa',
    } as never);

    await expect(service.clear(owner)).resolves.toMatchObject({
      items: [],
      totalQuantity: 0,
      totalAmount: 0,
    });
    expect(items).toHaveLength(0);
  });

  it('faol savat bo‘lmasa ham 404 emas, bo‘sh savat qaytaradi', async () => {
    await expect(service.clear({ sessionId: 'yo‘q' })).resolves.toMatchObject({
      id: null,
      items: [],
      totalQuantity: 0,
    });
  });

  it('savatni bo‘shatish takrorlansa ham xato bermaydi', async () => {
    const owner = { sessionId: 'guest-1' };
    await service.add(owner, { productId: '1', variantId: '2', quantity: 3 }, {
      productId: '1',
      variantId: '2',
      shopId: '5',
      price: 1000,
      productName: 'Mahsulot',
    } as never);
    await service.clear(owner);
    await expect(service.clear(owner)).resolves.toMatchObject({ items: [] });
  });

  it('owner berilmasa savatni bo‘shatishni rad etadi', async () => {
    await expect(service.clear({})).rejects.toThrow('x-session-id');
  });
});
