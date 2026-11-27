import { NEVER, of, throwError } from 'rxjs';
import { CatalogOfferService } from './catalog-offer.service';

/** BE-16: offer qoldig‘i HQ ombordan; inventory javob bermasa — null (noma’lum), 0 emas. */
describe('CatalogOfferService.stockOf (BE-16)', () => {
  const variants = {
    find: jest.fn(async () => [
      { id: '11', productId: '1' },
      { id: '12', productId: '1' },
    ]),
  };
  const make = (send: jest.Mock) =>
    new CatalogOfferService(
      {} as never,
      {} as never,
      variants as never,
      { send } as never,
      { forProducts: async () => new Map() } as never,
    ) as unknown as {
      stockOf(ids: string[]): Promise<Map<string, number | null>>;
    };

  afterEach(() => jest.useRealTimers());

  it('faol variantlar bo‘sh qoldig‘i mahsulot bo‘yicha qo‘shiladi; varianti yo‘q mahsulot — 0', async () => {
    const send = jest.fn(() => of({ '11': 3, '12': 2 }));
    const stock = await make(send).stockOf(['1', '2']);
    expect(send).toHaveBeenCalledWith(
      { cmd: 'inventory.available' },
      { variantIds: ['11', '12'] },
    );
    expect(Object.fromEntries(stock)).toEqual({ '1': 5, '2': 0 });
  });

  it('inventory xatosi → null (lid qabul ochiq qoladi)', async () => {
    const send = jest.fn(() => throwError(() => new Error('inventory yo‘q')));
    const stock = await make(send).stockOf(['1']);
    expect(stock.get('1')).toBeNull();
  });

  it('inventory javob bermasa 1,5 s dan keyin → null (offer kutib qolmaydi)', async () => {
    jest.useFakeTimers();
    const send = jest.fn(() => NEVER);
    const pending = make(send).stockOf(['1']);
    await jest.advanceTimersByTimeAsync(1500);
    await expect(pending).resolves.toEqual(new Map([['1', null]]));
  });
});

/** BE-29: checkout savat va qaytarishlar uchun ko‘rinish ma’lumoti — checkout `catalog.*` ga SQL yozmasligi uchun. */
describe('CatalogOfferService.displayLookup (BE-29)', () => {
  const make = (query: jest.Mock) =>
    new CatalogOfferService(
      { manager: { query } } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never, // BE-08 (PR 127): kreativlar
    );

  it('ID lar bo‘yicha do‘kon nomi, mahsulot nomi va rasmi, variant rasmi; noto‘g‘ri va takroriy ID tashlanadi', async () => {
    const query = jest.fn(async (sql: string, [ids]: string[][] = [[]]) => {
      if (sql.includes('FROM catalog.shop'))
        return ids.map((id) => ({ id, name: `Do‘kon ${id}` }));
      if (sql.includes('FROM catalog.product_variant'))
        return ids.map((id) => ({ id, name: 'Smartfon', imageUrl: '' }));
      // BE-25: «muddat kuzatiladi» belgisi toifadan meros
      if (sql.includes('FROM catalog.category'))
        return [
          { id: '3', parentId: null, isBad: null, expiryTracked: true },
          { id: '4', parentId: '3', isBad: null, expiryTracked: null },
        ];
      return ids.map((id) => ({
        id,
        name: id === '13' ? null : `Mahsulot ${id}`,
        imageUrl: `https://cdn/${id}.webp`,
        categoryId: id === '10' ? '4' : null,
        isBad: id === '12',
      }));
    });

    await expect(
      make(query).displayLookup({
        shopIds: ['7', '7', 'x', '0'],
        productIds: ['10', '12', '13', '99999999999999999999'],
        variantIds: ['11'],
      }),
    ).resolves.toEqual({
      shops: [{ id: '7', name: 'Do‘kon 7' }],
      products: [
        {
          id: '10',
          name: 'Mahsulot 10',
          imageUrl: 'https://cdn/10.webp',
          expiryTracked: true,
        },
        {
          id: '12',
          name: 'Mahsulot 12',
          imageUrl: 'https://cdn/12.webp',
          expiryTracked: true,
        },
        {
          id: '13',
          name: null,
          imageUrl: 'https://cdn/13.webp',
          expiryTracked: false,
        },
      ],
      variants: [{ id: '11', name: 'Smartfon', imageUrl: null }],
    });
    expect(query.mock.calls.map((call) => call[1])).toEqual([
      [['7']],
      [['10', '12', '13']],
      undefined, // toifa belgilari — bir marta
      [['11']],
    ]);
  });

  it('bo‘sh so‘rov bazaga bormaydi', async () => {
    const query = jest.fn();
    await expect(make(query).displayLookup({})).resolves.toEqual({
      shops: [],
      products: [],
      variants: [],
    });
    expect(query).not.toHaveBeenCalled();
  });
});

/** BE-25 (FE-12): ro‘yxat qatorlari va «Diqqat» filtri — javob bermagan qism null va `unavailable`. */
describe('CatalogOfferService: ro‘yxat qo‘shimchalari (FE-12)', () => {
  const product = (id: string) =>
    ({ id, basePrice: 140000, weightGrams: 300, approvedPrice: null }) as never;
  const make = (
    send: jest.Mock,
    pricing: Record<string, unknown> = {
      context: async () => ({ tariff: {} }),
      listPrice: () => ({
        customer: 262000,
        recommended: true,
        delivery: 30000,
        deliveryMode: 'PARTIAL',
      }),
    },
  ) =>
    new CatalogOfferService(
      {
        find: jest.fn(async () => [{ id: '1' }]),
      } as never,
      pricing as never,
      {
        find: jest.fn(async () => [
          { id: '11', productId: '1' },
          { id: '12', productId: '1' },
        ]),
      } as never,
      { send } as never,
      {
        forProducts: async () => new Map([['1', [{ id: '5', type: 'VIDEO' }]]]),
      } as never,
    );

  it('ombor qoldig‘i variantlar bo‘yicha qo‘shiladi; narx va video', async () => {
    const send = jest.fn(() =>
      of({
        '11': { onHand: 4, reserved: 1, available: 3, incoming: 0 },
        '12': { onHand: 2, reserved: 0, available: 2, incoming: 60 },
      }),
    );
    const { byId, unavailable } = await make(send).adminListExtras([
      product('1'),
      product('2'),
    ]);
    expect(unavailable).toEqual([]);
    expect(byId.get('1')).toEqual({
      stock: { onHand: 6, reserved: 1, available: 5, incoming: 60 },
      listPrice: {
        customer: 262000,
        recommended: true,
        delivery: 30000,
        deliveryMode: 'PARTIAL',
      },
      hasVideo: true,
    });
    // postavka yo‘q
    expect(byId.get('2')).toMatchObject({ stock: null, hasVideo: false });
  });

  it('ombor javob bermasa — qoldiq null, `stock` unavailable; narx sozlamasi yo‘q — `listPrice`', async () => {
    const send = jest.fn(() => throwError(() => new Error('inventory yo‘q')));
    const { byId, unavailable } = await make(send, {
      context: async () => {
        throw new Error('Elchi tarifi yo‘q');
      },
      listPrice: jest.fn(),
    }).adminListExtras([product('1')]);
    expect(unavailable.sort()).toEqual(['listPrice', 'stock']);
    expect(byId.get('1')).toMatchObject({ stock: null, listPrice: null });
  });

  it('«Muddat yaqin»: partiyalar variant orqali mahsulotga; ombor javob bermasa — null', async () => {
    const lots = jest.fn(() =>
      of([{ variantId: '11' }, { variantId: '12' }, { variantId: 'x' }]),
    );
    await expect(make(lots).expirySoonIds()).resolves.toEqual(['1']);
    const down = jest.fn(() => throwError(() => new Error('yo‘q')));
    await expect(make(down).expirySoonIds()).resolves.toBeNull();
  });
});
