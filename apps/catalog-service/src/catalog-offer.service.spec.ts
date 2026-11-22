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

  it('ID lar bo‘yicha do‘kon nomi, mahsulot va variant rasmi; noto‘g‘ri va takroriy ID tashlanadi', async () => {
    const query = jest.fn(async (sql: string, [ids]: string[][]) => {
      if (sql.includes('FROM catalog.shop'))
        return ids.map((id) => ({ id, name: `Do‘kon ${id}` }));
      if (sql.includes('FROM catalog.product_variant'))
        return ids.map((id) => ({ id, name: 'Smartfon', imageUrl: '' }));
      return ids.map((id) => ({ id, imageUrl: `https://cdn/${id}.webp` }));
    });

    await expect(
      make(query).displayLookup({
        shopIds: ['7', '7', 'x', '0'],
        productIds: ['10', '99999999999999999999'],
        variantIds: ['11'],
      }),
    ).resolves.toEqual({
      shops: [{ id: '7', name: 'Do‘kon 7' }],
      products: [{ id: '10', imageUrl: 'https://cdn/10.webp' }],
      variants: [{ id: '11', name: 'Smartfon', imageUrl: null }],
    });
    expect(query).toHaveBeenCalledTimes(3);
    expect(query.mock.calls.map((call) => call[1])).toEqual([
      [['7']],
      [['10']],
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
