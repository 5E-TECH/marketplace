import { Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { randomBytes } from 'crypto';
import { SharedRateLimiter } from './shared-rate-limiter';

const quiet = { log: jest.fn(), warn: jest.fn() } as unknown as Logger;
const memoryLimiter = () =>
  new SharedRateLimiter({ prefix: 'test:', name: 'test', logger: quiet });

describe('BE-36: SharedRateLimiter — xotira (Redis berilmagan yoki uzilgan)', () => {
  it('qat’iy oyna: chegaragacha o‘tadi, oshgani rad etiladi, oyna tugagach yana ochiladi (blok yo‘q)', async () => {
    const limiter = memoryLimiter();
    const t0 = 1_000_000;
    for (let i = 1; i <= 3; i++)
      expect(await limiter.hit('k', 60_000, 3, 0, t0 + i)).toMatchObject({
        totalHits: i,
        isBlocked: false,
      });
    expect(await limiter.hit('k', 60_000, 3, 0, t0 + 10)).toMatchObject({
      totalHits: 4,
      isBlocked: true,
      timeToBlockExpireMs: 0,
      timeToExpireMs: 60_000 - 9,
    });
    // oyna birinchi so‘rovdan (t0 + 1) bir daqiqa
    expect(await limiter.hit('k', 60_000, 3, 0, t0 + 60_001)).toMatchObject({
      totalHits: 1,
      isBlocked: false,
    });
    expect(limiter.redisConfigured).toBe(false);
    expect(limiter.store).toBe('memory');
  });

  it('blok: chegaradan oshganda blok muddati davomida rad etiladi, keyin hisob noldan', async () => {
    const limiter = memoryLimiter();
    const t0 = 5_000_000;
    await limiter.hit('b', 60_000, 1, 30_000, t0);
    expect(await limiter.hit('b', 60_000, 1, 30_000, t0 + 1)).toMatchObject({
      isBlocked: true,
      timeToBlockExpireMs: 30_000,
    });
    expect(
      await limiter.hit('b', 60_000, 1, 30_000, t0 + 20_000),
    ).toMatchObject({ isBlocked: true, timeToBlockExpireMs: 10_001 });
    expect(
      await limiter.hit('b', 60_000, 1, 30_000, t0 + 30_001),
    ).toMatchObject({ totalHits: 1, isBlocked: false });
  });

  it('kalitlar alohida; eskirgan kalitlar xotiradan tozalanadi', async () => {
    const limiter = memoryLimiter();
    const t0 = 9_000_000;
    await limiter.hit('a', 1_000, 1, 0, t0);
    expect(await limiter.hit('c', 1_000, 1, 0, t0)).toMatchObject({
      isBlocked: false,
    });
    const memory = (limiter as unknown as { memory: Map<string, unknown> })
      .memory;
    expect(memory.size).toBe(2);
    await limiter.hit('d', 1_000, 1, 0, t0 + 120_000);
    expect([...memory.keys()]).toEqual(['d']);
  });

  it('Redis manzili ishlamasa — so‘rov yiqilmaydi, hisob shu nusxa xotirasida', async () => {
    const limiter = new SharedRateLimiter({
      url: 'redis://127.0.0.1:1',
      prefix: 'test:',
      name: 'test-down',
      logger: quiet,
    });
    try {
      expect(limiter.redisConfigured).toBe(true);
      expect(limiter.store).toBe('memory');
      expect(await limiter.hit('x', 60_000, 1)).toMatchObject({
        totalHits: 1,
        isBlocked: false,
      });
      expect(await limiter.hit('x', 60_000, 1)).toMatchObject({
        isBlocked: true,
      });
    } finally {
      await limiter.close();
    }
    await limiter.close(); // takror yopish xavfsiz
  });
});

const redisUrl = process.env.TEST_REDIS_URL;
const withRedis = redisUrl ? describe : describe.skip;

withRedis('BE-36: SharedRateLimiter — Redis (TEST_REDIS_URL)', () => {
  const limiters: SharedRateLimiter[] = [];
  let admin: Redis;
  const make = () => {
    const limiter = new SharedRateLimiter({
      url: redisUrl,
      prefix: 'test:rl:',
      name: 'test',
      logger: quiet,
    });
    limiters.push(limiter);
    return limiter;
  };
  const ready = async (limiter: SharedRateLimiter) => {
    for (let i = 0; i < 100 && limiter.store !== 'redis'; i++)
      await new Promise((r) => setTimeout(r, 20));
    expect(limiter.store).toBe('redis');
  };
  const key = () => randomBytes(6).toString('hex');

  beforeAll(() => {
    admin = new Redis(redisUrl!);
  });
  afterAll(async () => {
    await Promise.all(limiters.map((l) => l.close()));
    await admin?.quit();
  });

  it('TC1 asosi: ikki nusxa bitta hisoblagichni ko‘radi', async () => {
    const [a, b] = [make(), make()];
    await ready(a);
    await ready(b);
    const k = key();
    expect((await a.hit(k, 60_000, 3)).totalHits).toBe(1);
    expect((await b.hit(k, 60_000, 3)).totalHits).toBe(2);
    expect((await a.hit(k, 60_000, 3)).isBlocked).toBe(false);
    expect(await b.hit(k, 60_000, 3)).toMatchObject({
      totalHits: 4,
      isBlocked: true,
    });
    // hisoblagich muddati oyna bilan, hash-teg bilan
    const ttl = await admin.pttl(`test:rl:{${k}}:h`);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(60_000);
  });

  it('blok ikkala nusxada; blok tugagach hisob noldan', async () => {
    const [a, b] = [make(), make()];
    await ready(a);
    await ready(b);
    const k = key();
    await a.hit(k, 60_000, 1, 300);
    expect(await b.hit(k, 60_000, 1, 300)).toMatchObject({ isBlocked: true });
    const blocked = await a.hit(k, 60_000, 1, 300);
    expect(blocked.isBlocked).toBe(true);
    expect(blocked.timeToBlockExpireMs).toBeGreaterThan(0);
    expect(blocked.timeToBlockExpireMs).toBeLessThanOrEqual(300);
    await new Promise((r) => setTimeout(r, 350));
    expect(await b.hit(k, 60_000, 1, 300)).toMatchObject({
      totalHits: 1,
      isBlocked: false,
    });
  });

  it('oyna tugagach hisob noldan (blok yo‘q)', async () => {
    const a = make();
    await ready(a);
    const k = key();
    await a.hit(k, 200, 1);
    expect((await a.hit(k, 200, 1)).isBlocked).toBe(true);
    await new Promise((r) => setTimeout(r, 250));
    expect(await a.hit(k, 200, 1)).toMatchObject({
      totalHits: 1,
      isBlocked: false,
    });
  });
});
