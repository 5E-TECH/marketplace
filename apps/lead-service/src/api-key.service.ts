import {
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes } from 'crypto';
import { IsNull, Repository } from 'typeorm';
import {
  AffiliateApiKeyCreatedDto,
  AffiliateApiKeyDto,
  ErrorCode,
} from '@app/common';
import { AffiliateApiKey } from './entities';

const ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
/** Kalit ko‘rinishi «elk_» + 32 belgi [taklif]. */
const KEY_PREFIX = 'elk_';
const KEY_BODY = 32;
const SHOWN_PREFIX = 8;
const MINUTE_MS = 60_000;

export const hashApiKey = (key: string) =>
  createHash('sha256').update(key).digest('hex');

/**
 * Sotuvchining lid API kaliti (BE-43, SOT-6). Bazada faqat xesh; bekor qilingan kalit darhol ishlamaydi.
 * Daqiqasiga so‘rovlar chegarasi — `rate_limit_per_minute` (sukut 60, SOT-6). Hisob shu nusxa xotirasida:
 * ishga tushishda lead-service bitta nusxa; bir nechta bo‘lsa — Redis (BE-36).
 */
@Injectable()
export class ApiKeyService {
  private readonly windows = new Map<
    string,
    { start: number; count: number }
  >();

  constructor(
    @InjectRepository(AffiliateApiKey)
    private readonly keys: Repository<AffiliateApiKey>,
  ) {}

  async create(affiliateId: string): Promise<AffiliateApiKeyCreatedDto> {
    const bytes = randomBytes(KEY_BODY);
    let body = '';
    for (const b of bytes) body += ALPHABET[b % ALPHABET.length];
    const key = `${KEY_PREFIX}${body}`;
    const row = await this.keys.save(
      this.keys.create({
        affiliateId,
        keyHash: hashApiKey(key),
        keyPrefix: key.slice(0, SHOWN_PREFIX),
      }),
    );
    return { ...this.toDto(row), key };
  }

  async list(affiliateId: string): Promise<AffiliateApiKeyDto[]> {
    const rows = await this.keys.find({
      where: { affiliateId, isDeleted: false },
      order: { id: 'DESC' },
    });
    return rows.map((r) => this.toDto(r));
  }

  async revoke(affiliateId: string, id: string): Promise<AffiliateApiKeyDto> {
    const row = await this.keys.findOne({
      where: { id, affiliateId, isDeleted: false },
    });
    if (!row) throw new NotFoundException('Kalit topilmadi');
    if (!row.revokedAt) {
      row.revokedAt = new Date();
      await this.keys.save(row);
    }
    return this.toDto(row);
  }

  /** TC4: kalitsiz yoki bekor qilingan → 401; TC3: chegaradan oshsa → 429. */
  async authenticate(
    raw: string | null | undefined,
    now = new Date(),
  ): Promise<AffiliateApiKey> {
    if (!raw) throw new UnauthorizedException('X-Api-Key sarlavhasi kerak');
    const row = await this.keys.findOne({
      where: {
        keyHash: hashApiKey(raw),
        revokedAt: IsNull(),
        isDeleted: false,
      },
    });
    if (!row)
      throw new UnauthorizedException('Kalit noto‘g‘ri yoki bekor qilingan');
    this.consume(row, now);
    row.lastUsedAt = now;
    await this.keys.update(row.id, { lastUsedAt: now });
    return row;
  }

  private consume(row: AffiliateApiKey, now: Date): void {
    const t = now.getTime();
    const w = this.windows.get(row.id);
    if (!w || t - w.start >= MINUTE_MS) {
      this.windows.set(row.id, { start: t, count: 1 });
      return;
    }
    w.count += 1;
    if (w.count > row.rateLimitPerMinute)
      throw new HttpException(
        {
          message: `Daqiqasiga ${row.rateLimitPerMinute} tadan ortiq so‘rov`,
          errorCode: ErrorCode.RATE_LIMITED,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
  }

  private toDto(r: AffiliateApiKey): AffiliateApiKeyDto {
    return {
      id: r.id,
      prefix: r.keyPrefix,
      rateLimitPerMinute: r.rateLimitPerMinute,
      createdAt: r.createdAt,
      lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
      revokedAt: r.revokedAt?.toISOString() ?? null,
    };
  }
}
