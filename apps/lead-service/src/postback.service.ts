import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { lookup as dnsLookup, LookupAddress } from 'dns';
import { request as httpRequest } from 'http';
import { request as httpsRequest } from 'https';
import { DataSource, EntityManager, In } from 'typeorm';
import {
  AffiliatePostbackDto,
  AffiliatePostbackEvent,
  AffiliatePostbacksPageDto,
  AffiliatePostbackStatus,
  assertSafeUrl,
  decryptSecret,
  isPrivateAddress,
  signHmacSha256,
} from '@app/common';
import { Lead, PostbackDelivery, Stream } from './entities';

/** Namuna: notification-service `notification.service.ts:28, 216-219` — 5 urinish, 2^(n-1) daqiqa, ko‘pi bilan 60. */
export const POSTBACK_RULES = {
  maxAttempts: 5,
  maxDelayMinutes: 60,
  /** Gateway RPC kutishi bilan bir xil (`rpc.util.ts` RPC_TIMEOUT_MS). */
  timeoutMs: 10_000,
  /** Yuborish uchun «band» qilish muddati: bir nusxa yuborayotganda ikkinchisi olmaydi. */
  leaseMs: 2 * 60_000,
  batch: 20,
} as const;

export const postbackRetryAt = (attempts: number, now: Date) =>
  new Date(
    now.getTime() +
      Math.min(2 ** (attempts - 1), POSTBACK_RULES.maxDelayMinutes) * 60_000,
  );

/** URL makrolari [taklif]. Variant (S1/S3) yo‘q (sinov-s1-s3.md). */
export function buildPostbackUrl(
  template: string,
  lead: Pick<
    Lead,
    'id' | 'clickId' | 'productId' | 'sub1' | 'sub2' | 'sub3' | 'sub4' | 'sub5'
  >,
  event: AffiliatePostbackEvent,
): string {
  const values: Record<string, string> = {
    status: event,
    lead_id: lead.id,
    click_id: lead.clickId ?? '',
    product_id: lead.productId,
    sub1: lead.sub1 ?? '',
    sub2: lead.sub2 ?? '',
    sub3: lead.sub3 ?? '',
    sub4: lead.sub4 ?? '',
    sub5: lead.sub5 ?? '',
  };
  return template.replace(/\{(\w+)\}/g, (m, key: string) =>
    key in values ? encodeURIComponent(values[key]) : m,
  );
}

/** DNS javobidagi har manzil tekshiriladi va ulanish aynan shu manzilga (DNS rebinding oralig‘i yo‘q). */
function safeLookup(
  hostname: string,
  options: object,
  callback: (
    err: NodeJS.ErrnoException | null,
    address: string | LookupAddress[],
    family?: number,
  ) => void,
): void {
  dnsLookup(hostname, { all: true }, (err, addresses) => {
    if (err) return callback(err, '', 0);
    const list = addresses as LookupAddress[];
    if (!list.length || list.some((a) => isPrivateAddress(a.address)))
      return callback(
        Object.assign(new Error('SSRF: ichki manzil'), { code: 'ESSRF' }),
        '',
        0,
      );
    if ((options as { all?: boolean }).all) return callback(null, list);
    callback(null, list[0].address, list[0].family);
  });
}

export type PostbackSender = (
  url: string,
  headers: Record<string, string>,
) => Promise<number>;

/** GET so‘rov; redirect kuzatilmaydi (3xx — muvaffaqiyatsiz). Javob kodi qaytadi. */
export const sendPostback: PostbackSender = (url, headers) =>
  new Promise((resolve, reject) => {
    const target = assertSafeUrl(url);
    const req = (target.protocol === 'https:' ? httpsRequest : httpRequest)(
      target,
      {
        method: 'GET',
        headers,
        lookup: safeLookup as never,
        timeout: POSTBACK_RULES.timeoutMs,
      },
      (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      },
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });

/**
 * Postback (BE-14; SOT-5): lid hodisasi o‘z tranzaksiyasida navbatga yoziladi (lead_id + event unikal),
 * har 30 soniyada yuboriladi, 5 urinishdan keyin FAILED. Sotuvchi jurnalni ko‘radi.
 */
@Injectable()
export class PostbackService {
  private readonly logger = new Logger(PostbackService.name);
  sender: PostbackSender = sendPostback;

  constructor(
    private readonly db: DataSource,
    private readonly config: ConfigService,
  ) {}

  /** Sahifada postback URL bo‘lsa navbatga qo‘yadi (takror hodisa e’tiborsiz). */
  async enqueue(
    manager: EntityManager,
    lead: Pick<Lead, 'id' | 'streamId'>,
    event: AffiliatePostbackEvent,
  ): Promise<void> {
    if (!lead.streamId) return;
    const stream = await manager
      .getRepository(Stream)
      .findOne({ where: { id: lead.streamId } });
    if (!stream?.postbackUrl) return;
    await manager
      .createQueryBuilder()
      .insert()
      .into(PostbackDelivery)
      .values({
        leadId: lead.id,
        streamId: stream.id,
        event,
        attempts: 0,
        nextAttemptAt: new Date(),
      })
      .orIgnore()
      .execute();
  }

  @Cron(CronExpression.EVERY_30_SECONDS, {
    name: 'lead-postback',
    waitForCompletion: true,
  })
  async run(): Promise<void> {
    try {
      await this.sendDue();
    } catch (error) {
      this.logger.error(`Postback yuborish xato: ${(error as Error).message}`);
    }
  }

  /** Vaqti kelganlarni qisqa tranzaksiyada band qiladi, HTTP ni tranzaksiyadan tashqarida yuboradi. */
  async sendDue(now = new Date()): Promise<number> {
    const claimed = await this.db.transaction(async (manager) => {
      const rows = await manager
        .getRepository(PostbackDelivery)
        .createQueryBuilder('d')
        .where('d.delivered_at IS NULL AND d.next_attempt_at <= :now', { now })
        .orderBy('d.next_attempt_at', 'ASC')
        .take(POSTBACK_RULES.batch)
        .setLock('pessimistic_write')
        .setOnLocked('skip_locked')
        .getMany();
      if (rows.length)
        await manager
          .getRepository(PostbackDelivery)
          .update(
            { id: In(rows.map((r) => r.id)) },
            { nextAttemptAt: new Date(now.getTime() + POSTBACK_RULES.leaseMs) },
          );
      return rows;
    });
    let sent = 0;
    for (const row of claimed) if (await this.deliver(row, now)) sent++;
    return sent;
  }

  async journal(
    affiliateId: string,
    query: { page?: number; limit?: number; streamId?: string },
  ): Promise<AffiliatePostbacksPageDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const qb = this.db
      .getRepository(PostbackDelivery)
      .createQueryBuilder('d')
      .innerJoin(Stream, 's', 's.id = d.stream_id')
      .where('s.affiliate_id = :affiliateId', { affiliateId });
    if (query.streamId)
      qb.andWhere('d.stream_id = :sid', { sid: query.streamId });
    const [rows, total] = await qb
      .orderBy('d.id', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();
    const codes = new Map(
      (
        await this.db.getRepository(Stream).find({
          where: { id: In([...new Set(rows.map((r) => r.streamId))]) },
        })
      ).map((s) => [s.id, s.code]),
    );
    return {
      items: rows.map((r): AffiliatePostbackDto => ({
        id: r.id,
        leadId: r.leadId,
        streamCode: codes.get(r.streamId) ?? '',
        event: r.event as AffiliatePostbackEvent,
        status: r.deliveredAt
          ? AffiliatePostbackStatus.SENT
          : r.nextAttemptAt
            ? AffiliatePostbackStatus.PENDING
            : AffiliatePostbackStatus.FAILED,
        attempts: r.attempts,
        responseCode: r.responseCode,
        deliveredAt: r.deliveredAt?.toISOString() ?? null,
        nextAttemptAt: r.nextAttemptAt?.toISOString() ?? null,
        createdAt: r.createdAt,
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  private async deliver(row: PostbackDelivery, now: Date): Promise<boolean> {
    const repo = this.db.getRepository(PostbackDelivery);
    const [lead, stream] = await Promise.all([
      this.db.getRepository(Lead).findOne({ where: { id: row.leadId } }),
      this.db.getRepository(Stream).findOne({ where: { id: row.streamId } }),
    ]);
    if (!lead || !stream?.postbackUrl) {
      await repo.update(row.id, { nextAttemptAt: null });
      return false;
    }
    const url = buildPostbackUrl(
      stream.postbackUrl,
      lead,
      row.event as AffiliatePostbackEvent,
    );
    const headers: Record<string, string> = {
      'user-agent': 'Elchi-Postback/1.0',
    };
    if (stream.postbackSecretEnc) {
      const ts = String(Math.floor(now.getTime() / 1000));
      let secret: string;
      try {
        secret = decryptSecret(
          stream.postbackSecretEnc,
          this.config.getOrThrow<string>('INTEGRATION_CREDENTIAL_SECRET'),
        );
      } catch {
        // Kalit almashgan yoki yozuv buzuq: imzosiz yubormaymiz, qator abadiy navbatda qolmasin — FAILED
        await repo.update(row.id, {
          attempts: row.attempts + 1,
          nextAttemptAt: null,
        });
        return false;
      }
      headers['x-elchi-timestamp'] = ts;
      headers['x-elchi-signature'] =
        `sha256=${signHmacSha256(`${ts}.${url}`, secret)}`;
    }
    const attempts = row.attempts + 1;
    let code: number | null = null;
    try {
      code = await this.sender(url, headers);
    } catch {
      code = null;
    }
    if (code !== null && code >= 200 && code < 300) {
      await repo.update(row.id, {
        attempts,
        responseCode: code,
        deliveredAt: now,
        nextAttemptAt: null,
      });
      return true;
    }
    await repo.update(row.id, {
      attempts,
      responseCode: code,
      nextAttemptAt:
        attempts >= POSTBACK_RULES.maxAttempts
          ? null
          : postbackRetryAt(attempts, now),
    });
    return false;
  }
}
