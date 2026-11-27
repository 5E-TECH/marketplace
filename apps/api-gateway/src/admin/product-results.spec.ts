import { of, throwError } from 'rxjs';
import {
  PRODUCT_RESULTS_RETRY_MS,
  PRODUCT_RESULTS_STALE_MAX_MS,
  PRODUCT_RESULTS_TTL_MS,
  ProductResultsCache,
} from './product-results';

/** BE-25 (FE-12): mahsulot natijalari keshi — muvaffaqiyat 5 daqiqa; xato — 1 daqiqa, eski natija `stale` bilan (1 soatgacha). */
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
  const ok = (leads: number) => of({ rows: [row('42', leads)], totals: {} });
  const down = () => throwError(() => new Error('lead sekin'));

  it('bir vaqtdagi so‘rovlar bitta chaqiruv; 5 daqiqa kesh', async () => {
    now = 0;
    const send = jest.fn(() => ok(3));
    const cache = new ProductResultsCache({ send } as never, clock);
    const [a, b] = await Promise.all([cache.get(), cache.get()]);
    expect(a).toBe(b);
    expect(a.stale).toBe(false);
    expect(a.value!.get('42')!.leads).toBe(3);
    expect(send).toHaveBeenCalledTimes(1);
    now = PRODUCT_RESULTS_TTL_MS - 1;
    await cache.get();
    expect(send).toHaveBeenCalledTimes(1);
    now = PRODUCT_RESULTS_TTL_MS;
    await cache.get();
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('xato — 1 daqiqa qayta so‘ralmaydi; eski natija `stale` belgisi bilan', async () => {
    now = 0;
    const send = jest.fn();
    send.mockReturnValueOnce(ok(3));
    const cache = new ProductResultsCache({ send } as never, clock);
    await cache.get();
    send.mockReturnValue(down());
    now = PRODUCT_RESULTS_TTL_MS;
    const stale = await cache.get();
    expect(stale.stale).toBe(true);
    expect(stale.value!.get('42')!.leads).toBe(3);
    expect(send).toHaveBeenCalledTimes(2);
    now += PRODUCT_RESULTS_RETRY_MS - 1;
    expect((await cache.get()).stale).toBe(true);
    expect(send).toHaveBeenCalledTimes(2);
    now += 1;
    send.mockReturnValue(ok(5));
    const fresh = await cache.get();
    expect(fresh).toMatchObject({ stale: false });
    expect(fresh.value!.get('42')!.leads).toBe(5);
    expect(send).toHaveBeenCalledTimes(3);
  });

  it('eski natija 1 soatdan oshsa — berilmaydi (null, `stale`)', async () => {
    now = 0;
    const send = jest.fn();
    send.mockReturnValueOnce(ok(3));
    const cache = new ProductResultsCache({ send } as never, clock);
    await cache.get();
    send.mockReturnValue(down());
    now = PRODUCT_RESULTS_STALE_MAX_MS;
    await expect(cache.get()).resolves.toEqual({ value: null, stale: true });
  });

  it('hech qachon olinmagan va xato — null, qayta so‘rov 1 daqiqadan keyin', async () => {
    now = 0;
    const send = jest.fn(down);
    const cache = new ProductResultsCache({ send } as never, clock);
    await expect(cache.get()).resolves.toEqual({ value: null, stale: true });
    await expect(cache.get()).resolves.toEqual({ value: null, stale: true });
    expect(send).toHaveBeenCalledTimes(1);
  });
});
