import { of, throwError } from 'rxjs';
import {
  PRODUCT_RESULTS_RETRY_MS,
  PRODUCT_RESULTS_TTL_MS,
  ProductResultsCache,
} from './product-results';

/** BE-25 (FE-12): mahsulot natijalari keshi — muvaffaqiyat 5 daqiqa, xato 1 daqiqa (eski natija bilan). */
describe('ProductResultsCache', () => {
  const row = (key: string, leads: number) => ({
    key,
    leads,
    clicks: 10,
    validLeads: leads,
    confirmed: 1,
    delivered: 1,
    refused: 0,
    approveRate: 50,
    saleRate: 100,
    affiliateIncome: 1000,
    epc: 100,
  });
  let now = 0;
  const clock = () => new Date(Date.UTC(2027, 0, 14) + now);

  it('bir vaqtdagi so‘rovlar bitta chaqiruv; 5 daqiqa kesh', async () => {
    now = 0;
    const send = jest.fn(() => of({ rows: [row('42', 3)], totals: {} }));
    const cache = new ProductResultsCache({ send } as never, clock);
    const [a, b] = await Promise.all([cache.get(), cache.get()]);
    expect(a).toBe(b);
    expect(a!.get('42')!.leads).toBe(3);
    expect(send).toHaveBeenCalledTimes(1);
    now = PRODUCT_RESULTS_TTL_MS - 1;
    await cache.get();
    expect(send).toHaveBeenCalledTimes(1);
    now = PRODUCT_RESULTS_TTL_MS;
    await cache.get();
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('xato — 1 daqiqa qayta so‘ralmaydi; oldin olingan natija berib turiladi', async () => {
    now = 0;
    const send = jest.fn();
    send.mockReturnValueOnce(of({ rows: [row('42', 3)], totals: {} }));
    const cache = new ProductResultsCache({ send } as never, clock);
    await cache.get();
    // kesh eskirdi, lid javob bermaydi — eski natija
    send.mockReturnValue(throwError(() => new Error('lead sekin')));
    now = PRODUCT_RESULTS_TTL_MS;
    expect((await cache.get())!.get('42')!.leads).toBe(3);
    expect(send).toHaveBeenCalledTimes(2);
    now += PRODUCT_RESULTS_RETRY_MS - 1;
    await cache.get();
    expect(send).toHaveBeenCalledTimes(2);
    now += 1;
    send.mockReturnValue(of({ rows: [row('42', 5)], totals: {} }));
    expect((await cache.get())!.get('42')!.leads).toBe(5);
    expect(send).toHaveBeenCalledTimes(3);
  });

  it('hech qachon olinmagan va xato — null', async () => {
    now = 0;
    const send = jest.fn(() => throwError(() => new Error('yo‘q')));
    const cache = new ProductResultsCache({ send } as never, clock);
    await expect(cache.get()).resolves.toBeNull();
    await expect(cache.get()).resolves.toBeNull();
    expect(send).toHaveBeenCalledTimes(1);
  });
});
