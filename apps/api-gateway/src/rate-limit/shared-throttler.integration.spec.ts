import {
  Controller,
  Get,
  Global,
  INestApplication,
  Logger,
  Module,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Throttle, ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { randomBytes } from 'crypto';
import { request } from 'http';
import { AddressInfo } from 'net';
import { configureTrustProxy } from '../trust-proxy';
import { RateLimitModule } from './rate-limit.module';
import { SharedThrottlerStorage } from './shared-throttler.storage';

/**
 * BE-36 TC1: «2 nusxada IP limiti umumiy». Ikki alohida Nest ilovasi (ikki gateway nusxasi, app.module dagi kabi
 * ThrottlerModule + SharedThrottlerStorage, trust proxy) bitta Redis bilan. Haqiqiy HTTP, IP — `X-Forwarded-For`
 * (loopback ishonchli proksi, trust-proxy.ts). Redis — TEST_REDIS_URL (CI da servis).
 */
@Controller('t')
class LimitedController {
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Get('login')
  login() {
    return { ok: true };
  }

  @Get('open')
  open() {
    return { ok: true };
  }
}

interface Instance {
  app: INestApplication;
  port: number;
  storage: SharedThrottlerStorage;
}

async function gateway(redisUrl: string | undefined): Promise<Instance> {
  const env: Record<string, string | undefined> = { REDIS_URL: redisUrl };
  @Global()
  @Module({
    providers: [
      {
        provide: ConfigService,
        useValue: { get: (k: string, d?: unknown) => env[k] ?? d },
      },
    ],
    exports: [ConfigService],
  })
  class TestConfigModule {}

  const moduleRef = await Test.createTestingModule({
    imports: [
      TestConfigModule,
      RateLimitModule,
      ThrottlerModule.forRootAsync({
        imports: [RateLimitModule],
        inject: [SharedThrottlerStorage],
        useFactory: (storage: SharedThrottlerStorage) => ({
          throttlers: [{ name: 'default', ttl: 60_000, limit: 5 }],
          storage,
        }),
      }),
    ],
    controllers: [LimitedController],
    providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
  }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({
    logger: false,
  });
  configureTrustProxy(app);
  app.enableShutdownHooks();
  await app.listen(0, '127.0.0.1');
  const storage = app.get(SharedThrottlerStorage);
  const { port } = app.getHttpServer().address() as AddressInfo;
  return { app, port, storage };
}

// `agent: false` — keep-alive ulanish qolmasin (ilova yopilgach jest jarayoni toza chiqadi).
function call(
  instance: Instance,
  path: string,
  ip: string,
): Promise<{ status: number; retryAfter: string | undefined }> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port: instance.port,
        path: `/t/${path}`,
        agent: false,
        headers: { 'x-forwarded-for': ip },
      },
      (res) => {
        res.resume();
        res.on('end', () =>
          resolve({
            status: res.statusCode!,
            retryAfter: res.headers['retry-after'] as string | undefined,
          }),
        );
      },
    );
    req.on('error', reject);
    req.end();
  });
}

async function redisReady(instance: Instance) {
  for (let i = 0; i < 100 && instance.storage.health().store !== 'redis'; i++)
    await new Promise((r) => setTimeout(r, 20));
  expect(instance.storage.health()).toEqual({
    redisConfigured: true,
    store: 'redis',
  });
}

// Har ishga tushirishda yangi IP lar (IPv6 hujjat tarmog‘i) — Redis’dagi oldingi hisob aralashmasin.
const run = randomBytes(2).toString('hex');
const ip = (n: number) => `2001:db8:${run}::${n}`;

const redisUrl = process.env.TEST_REDIS_URL;
const withRedis = redisUrl ? describe : describe.skip;

beforeAll(() => {
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
});

withRedis('BE-36 TC1: ikki gateway nusxasida IP limiti umumiy (Redis)', () => {
  let a: Instance;
  let b: Instance;

  beforeAll(async () => {
    a = await gateway(redisUrl);
    b = await gateway(redisUrl);
    await redisReady(a);
    await redisReady(b);
  });
  afterAll(async () => {
    await a?.app.close();
    await b?.app.close();
  });

  it('@Throttle (auth kabi, 3/daqiqa): A, B, A — o‘tadi; 4-so‘rov qaysi nusxaga tushmasin — 429', async () => {
    expect((await call(a, 'login', ip(1))).status).toBe(200);
    expect((await call(b, 'login', ip(1))).status).toBe(200);
    expect((await call(a, 'login', ip(1))).status).toBe(200);
    const blocked = await call(b, 'login', ip(1));
    expect(blocked.status).toBe(429);
    expect(Number(blocked.retryAfter)).toBeGreaterThan(0);
    expect(Number(blocked.retryAfter)).toBeLessThanOrEqual(60);
    expect((await call(a, 'login', ip(1))).status).toBe(429);
    // boshqa IP — o‘z hisobi
    expect((await call(b, 'login', ip(2))).status).toBe(200);
  });

  it('umumiy chegara (RATE_LIMIT_MAX kabi, 5/daqiqa) ham ikki nusxada bitta', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++)
      statuses.push((await call(i % 2 ? b : a, 'open', ip(3))).status);
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
  });
});

describe('BE-36: Redis’siz — limit shu nusxa xotirasida (avvalgidek)', () => {
  it('REDIS_URL berilmagan — @nestjs/throttler xotira saqlagichi', async () => {
    const c = await gateway(undefined);
    try {
      expect(c.storage.health()).toEqual({
        redisConfigured: false,
        store: 'memory',
      });
      for (let i = 0; i < 3; i++)
        expect((await call(c, 'login', ip(10))).status).toBe(200);
      expect((await call(c, 'login', ip(10))).status).toBe(429);
    } finally {
      await c.app.close();
    }
  });

  it('Redis manzili ishlamasa — 500 yo‘q, limit nusxa xotirasida, holat `memory`', async () => {
    const d = await gateway('redis://127.0.0.1:1');
    try {
      expect(d.storage.health()).toEqual({
        redisConfigured: true,
        store: 'memory',
      });
      for (let i = 0; i < 3; i++)
        expect((await call(d, 'login', ip(11))).status).toBe(200);
      const blocked = await call(d, 'login', ip(11));
      expect(blocked.status).toBe(429);
      expect(Number(blocked.retryAfter)).toBeGreaterThan(0);
    } finally {
      await d.app.close();
    }
  });
});
