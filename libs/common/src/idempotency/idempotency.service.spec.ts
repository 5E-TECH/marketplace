import { IdempotencyService } from './idempotency.service';

// TC5: bir kalit bilan 2x chaqirilsa -> fn 1 marta, yozuv 1 marta
describe('IdempotencyService (TC5)', () => {
  it('bir xil kalit bilan takror -> fn va save faqat 1 marta', async () => {
    const store = new Map<string, any>();
    const repo = {
      findOne: jest.fn(async ({ where: { key } }: any) => store.get(key) ?? null),
      create: (o: any) => o,
      save: jest.fn(async (r: any) => {
        store.set(r.key, r);
        return r;
      }),
    };
    const service = new IdempotencyService(repo as any);
    const fn = jest.fn(async () => ({ ok: true }));

    const first = await service.execute('k1', fn);
    const second = await service.execute('k1', fn);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(repo.save).toHaveBeenCalledTimes(1);
    expect(first).toEqual({ ok: true });
    expect(second).toEqual({ ok: true });
  });

  it('turli kalit -> alohida bajariladi', async () => {
    const store = new Map<string, any>();
    const repo = {
      findOne: jest.fn(async ({ where: { key } }: any) => store.get(key) ?? null),
      create: (o: any) => o,
      save: jest.fn(async (r: any) => {
        store.set(r.key, r);
        return r;
      }),
    };
    const service = new IdempotencyService(repo as any);
    const fn = jest.fn(async () => ({ ok: true }));

    await service.execute('a', fn);
    await service.execute('b', fn);

    expect(fn).toHaveBeenCalledTimes(2);
  });
});
