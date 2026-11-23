import { Logger } from '@nestjs/common';
import Redis from 'ioredis';

/**
 * BE-36 (T9-11, T8 «Masshtab»): bir nechta nusxa uchun umumiy so‘rov chegarasi.
 *
 * `REDIS_URL` berilsa hisob Redis’da — hamma nusxa bitta hisoblagichni ko‘radi (ikki gateway nusxasida IP limiti
 * umumiy, TC1). Berilmasa yoki Redis ishlamay qolsa — shu nusxa xotirasida (ishga tushishda bitta nusxa; Redis
 * uzilganda limit yo‘qolmaydi, faqat nusxalar orasida bo‘linmaydi). Redis xatosi so‘rovni hech qachon yiqitmaydi.
 *
 * Oyna qat’iy (fixed window): birinchi so‘rovdan `ttlMs` davomida sanaladi. Chegaradan oshganda `blockMs > 0` bo‘lsa
 * kalit shuncha vaqt bloklanadi va blok tugagach hisob noldan boshlanadi (`@nestjs/throttler` xotira saqlagichi
 * kabi); `blockMs = 0` — oyna tugaguncha har ortiqcha so‘rov rad etiladi.
 */
export interface RateWindowHit {
  /** Joriy oynadagi so‘rovlar soni (shu so‘rov bilan). */
  totalHits: number;
  /** Oyna (blokda — blok) tugashigacha, ms. */
  timeToExpireMs: number;
  /** Chegara oshgan yoki blok muddati tugamagan — so‘rov rad etiladi. */
  isBlocked: boolean;
  /** Blok tugashigacha, ms; blok yo‘q — 0. */
  timeToBlockExpireMs: number;
}

export type RateLimitStore = 'redis' | 'memory';

export interface SharedRateLimiterOptions {
  /** `redis://` yoki `rediss://`. Berilmasa — faqat shu nusxa xotirasi. */
  url?: string;
  /** Kalit prefiksi — servis va limit turi bo‘yicha, masalan `mp:rl:gw:`. */
  prefix: string;
  /** Redis ulanish nomi (`CLIENT LIST` da ko‘rinadi). */
  name: string;
  /**
   * Redis buyrug‘ini kutish chegarasi, ms [taklif]. Oshsa — shu so‘rov xotiradagi hisob bilan o‘tadi: limit tekshiruvi
   * so‘rovni sekinlashtirmasin.
   */
  commandTimeoutMs?: number;
  logger?: Logger;
}

/** [taklif] 250 ms — lokal tarmoqda Redis javobi millisekundlarda; undan uzoq kutish so‘rovni sekinlashtiradi. */
const DEFAULT_COMMAND_TIMEOUT_MS = 250;
/**
 * [taklif] 1 s — Redis ulanish ochiq, lekin javob bermasa (to‘xtatilgan jarayon, paket yo‘qolishi) soket shuncha vaqtdan
 * keyin yopiladi va klient qayta ulanadi; usiz holat `ready` bo‘lib qolib, har so‘rov buyruq chegarasini kutardi.
 */
const SOCKET_TIMEOUT_MS = 1_000;
/** [taklif] Redis buyrug‘i xato bersa, shuncha vaqt Redis’ga murojaat qilinmaydi — har so‘rov kutib qolmasin. */
const PAUSE_AFTER_ERROR_MS = 1_000;
/** Ogohlantirish logi tez-tez takrorlanmasin (Redis uzilganda har so‘rovda yozilmaydi). */
const WARN_EVERY_MS = 60_000;
/** Xotiradagi eskirgan kalitlarni tozalash oralig‘i. */
const SWEEP_EVERY_MS = 60_000;

/**
 * KEYS[1] — hisoblagich, KEYS[2] — blok belgisi; ARGV: ttlMs, limit, blockMs.
 * Qaytaradi: { hits, ttlMs, blocked (0|1), blockTtlMs }. Bitta skript — atomar (nusxalar poygasi yo‘q).
 */
const HIT_SCRIPT = `
local blockTtl = redis.call('PTTL', KEYS[2])
if blockTtl > 0 then
  return {tonumber(ARGV[2]) + 1, blockTtl, 1, blockTtl}
end
local hits = redis.call('INCR', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
if hits > tonumber(ARGV[2]) then
  local blockMs = tonumber(ARGV[3])
  if blockMs > 0 then
    redis.call('SET', KEYS[2], '1', 'PX', blockMs)
    redis.call('DEL', KEYS[1])
    return {hits, blockMs, 1, blockMs}
  end
  return {hits, ttl, 1, 0}
end
return {hits, ttl, 0, 0}
`;

type HitCommand = (
  hitsKey: string,
  blockKey: string,
  ttlMs: number,
  limit: number,
  blockMs: number,
) => Promise<[number, number, number, number]>;

interface MemoryEntry {
  hits: number;
  expiresAt: number;
  blockedUntil: number;
}

export class SharedRateLimiter {
  private readonly logger: Logger;
  private readonly redis: Redis | null;
  private readonly memory = new Map<string, MemoryEntry>();
  private sweepAt = 0;
  private lastWarnAt = 0;
  /** Xatodan keyin Redis’ga murojaat qilinmaydigan vaqt (epoch ms). */
  private pausedUntil = 0;
  private closing?: Promise<void>;

  constructor(private readonly options: SharedRateLimiterOptions) {
    this.logger = options.logger ?? new Logger(`RateLimit:${options.name}`);
    this.redis = options.url ? this.connect(options.url) : null;
  }

  /** `REDIS_URL` berilganmi. */
  get redisConfigured(): boolean {
    return this.redis !== null;
  }

  /** Hozir qayerda sanalmoqda: Redis tayyor va javob berayotgan bo‘lsa — `redis`, aks holda shu nusxa xotirasi. */
  get store(): RateLimitStore {
    return this.redisUsable(Date.now()) ? 'redis' : 'memory';
  }

  /** Bitta so‘rovni hisobga oladi. Hech qachon xato tashlamaydi: Redis ishlamasa — xotiradagi hisob. */
  async hit(
    key: string,
    ttlMs: number,
    limit: number,
    blockMs = 0,
    now = Date.now(),
  ): Promise<RateWindowHit> {
    if (this.redis) {
      if (this.redisUsable(Date.now())) {
        try {
          return await this.hitRedis(key, ttlMs, limit, blockMs);
        } catch (error) {
          this.pausedUntil = Date.now() + PAUSE_AFTER_ERROR_MS;
          this.warn(
            `Redis xatosi, xotiradagi hisob ishlatildi: ${message(error)}`,
          );
        }
      } else {
        this.warn(
          `Redis ishlatilmayapti (${this.redis.status}), xotiradagi hisob ishlatildi`,
        );
      }
    }
    return this.hitMemory(key, ttlMs, limit, blockMs, now);
  }

  /** Ulanishni yopadi; qayta ulanish to‘xtaydi. Takror chaqirish xavfsiz (bitta yopish). */
  close(): Promise<void> {
    this.closing ??= this.shutdown();
    return this.closing;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.close();
  }

  private redisUsable(now: number): boolean {
    return this.redis?.status === 'ready' && now >= this.pausedUntil;
  }

  private async shutdown(): Promise<void> {
    const redis = this.redis;
    if (!redis || redis.status === 'end') return;
    if (redis.status === 'ready') {
      try {
        await redis.quit();
        return;
      } catch {
        // pastda uziladi
      }
    }
    // Ulanmagan: `quit` qayta ulanishni to‘xtatmaydi — uzamiz. Ulanish urinishi davom etayotgan bo‘lsa soket yopilishini
    // (`end`) kutamiz, ko‘pi bilan 1 s; qayta ulanish kutilayotgan bo‘lsa soket allaqachon yopiq — kutish shart emas.
    const pending = redis.status === 'connecting' || redis.status === 'connect';
    await new Promise<void>((resolve) => {
      if (!pending) {
        redis.disconnect();
        resolve();
        return;
      }
      const timer = setTimeout(resolve, 1_000);
      timer.unref();
      redis.once('end', () => {
        clearTimeout(timer);
        resolve();
      });
      redis.disconnect();
    });
  }

  private connect(url: string): Redis {
    const redis = new Redis(url, {
      connectionName: this.options.name,
      // Uzilganda buyruq navbatga yig‘ilmaydi — darhol xato, so‘rov xotiradagi hisob bilan o‘tadi.
      enableOfflineQueue: false,
      maxRetriesPerRequest: 0,
      commandTimeout:
        this.options.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS,
      socketTimeout: SOCKET_TIMEOUT_MS,
      // Qayta ulanish to‘xtamaydi: 0,2 s dan 5 s gacha oshib boradi.
      retryStrategy: (times) => Math.min(times * 200, 5_000),
      // Yopishda yopilmagan soketni kutish (sukut 2 s) — jarayon chiqishini cho‘zmasin.
      disconnectTimeout: 200,
    });
    redis.defineCommand('mpRateHit', { numberOfKeys: 2, lua: HIT_SCRIPT });
    redis.on('error', (error) => this.warn(`Redis: ${message(error)}`));
    redis.on('ready', () => {
      this.logger.log('Redis ulandi — limit hamma nusxada umumiy');
      this.lastWarnAt = 0;
      this.pausedUntil = 0;
    });
    return redis;
  }

  private async hitRedis(
    key: string,
    ttlMs: number,
    limit: number,
    blockMs: number,
  ): Promise<RateWindowHit> {
    // Hash-teg `{…}` — ikkala kalit Redis Cluster’da ham bitta slotda.
    const base = `${this.options.prefix}{${key}}`;
    const run = (this.redis as unknown as { mpRateHit: HitCommand }).mpRateHit;
    const [hits, ttl, blocked, blockTtl] = await run.call(
      this.redis,
      `${base}:h`,
      `${base}:b`,
      Math.max(1, Math.round(ttlMs)),
      limit,
      Math.max(0, Math.round(blockMs)),
    );
    return {
      totalHits: Number(hits),
      timeToExpireMs: Math.max(0, Number(ttl)),
      isBlocked: Number(blocked) === 1,
      timeToBlockExpireMs: Math.max(0, Number(blockTtl)),
    };
  }

  private hitMemory(
    key: string,
    ttlMs: number,
    limit: number,
    blockMs: number,
    now: number,
  ): RateWindowHit {
    this.sweep(now);
    let entry = this.memory.get(key);
    if (entry && entry.blockedUntil > now) {
      const left = entry.blockedUntil - now;
      return {
        totalHits: limit + 1,
        timeToExpireMs: left,
        isBlocked: true,
        timeToBlockExpireMs: left,
      };
    }
    if (!entry || entry.expiresAt <= now) {
      entry = { hits: 0, expiresAt: now + ttlMs, blockedUntil: 0 };
      this.memory.set(key, entry);
    }
    entry.hits += 1;
    const hits = entry.hits;
    if (hits > limit) {
      if (blockMs > 0) {
        // Redis skripti kabi: blok qo‘yiladi, hisob blok tugagach noldan.
        entry.blockedUntil = now + blockMs;
        entry.hits = 0;
        entry.expiresAt = now;
        return {
          totalHits: hits,
          timeToExpireMs: blockMs,
          isBlocked: true,
          timeToBlockExpireMs: blockMs,
        };
      }
      return {
        totalHits: hits,
        timeToExpireMs: entry.expiresAt - now,
        isBlocked: true,
        timeToBlockExpireMs: 0,
      };
    }
    return {
      totalHits: hits,
      timeToExpireMs: entry.expiresAt - now,
      isBlocked: false,
      timeToBlockExpireMs: 0,
    };
  }

  private sweep(now: number): void {
    if (now < this.sweepAt) return;
    this.sweepAt = now + SWEEP_EVERY_MS;
    for (const [key, entry] of this.memory)
      if (entry.expiresAt <= now && entry.blockedUntil <= now)
        this.memory.delete(key);
  }

  private warn(text: string): void {
    const now = Date.now();
    if (now - this.lastWarnAt < WARN_EVERY_MS) return;
    this.lastWarnAt = now;
    this.logger.warn(text);
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
