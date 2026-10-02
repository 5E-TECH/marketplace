import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'node:crypto';
import {
  BroadcastAudience,
  BroadcastChannel,
  BroadcastDto,
  BroadcastPreviewDto,
  BroadcastPreviewResultDto,
  BroadcastSendDto,
  BroadcastsQueryDto,
  RmqClient,
  sendRpc,
} from '@app/common';
import { In, LessThan, QueryFailedError, Repository } from 'typeorm';
import { Broadcast } from './entities/broadcast.entity';
import { NotificationChannel } from './entities/notification-delivery.entity';
import { NotificationService } from './notification.service';

interface RecipientsPage {
  items: Array<{ id: string; phone: string; email: string | null }>;
  nextAfterId: string | null;
}

type BroadcastMessage = Pick<
  BroadcastPreviewDto,
  'audience' | 'title' | 'body'
> & { channels: BroadcastChannel[] };

/** Bir bo'lakda yuboriladigan foydalanuvchilar — kursor shu qadamda saqlanadi. */
export const BROADCAST_BATCH = 50;
/** Shu vaqt yangilanmagan SENDING — servis to'xtagan deb qayta olinadi. */
export const BROADCAST_STALE_MS = 2 * 60_000;
export const BROADCAST_MAX_ATTEMPTS = 5;

const CHANNELS: Record<BroadcastChannel, NotificationChannel> = {
  sms: NotificationChannel.SMS,
  email: NotificationChannel.EMAIL,
};

/**
 * C6.8 — ommaviy xabar. Kuchli qurol: xato yuborilsa qaytarib bo'lmaydi.
 * Shuning uchun:
 *  - yuborish faqat `preview` bergan token bilan — token xabar matni,
 *    kanallar, auditoriya va qabul qiluvchilar sonidan hisoblanadi; biror
 *    narsa o'zgarsa 409, admin qayta ko'rib chiqadi;
 *  - token noyob — ikki marta bosish ikki marta yubormaydi;
 *  - yuborish fonda, bo'lak-bo'lak, kursor bilan: servis qayta ishga tushsa
 *    yoki identity vaqtincha javob bermasa, xabar boshidan emas, to'xtagan
 *    joyidan davom etadi (foydalanuvchiga takror bormaydi).
 */
@Injectable()
export class BroadcastService {
  private readonly logger = new Logger(BroadcastService.name);
  private readonly running = new Set<string>();

  constructor(
    @InjectRepository(Broadcast)
    private readonly broadcasts: Repository<Broadcast>,
    private readonly notifications: NotificationService,
    @Inject(RmqClient.IDENTITY) private readonly identity: ClientProxy,
  ) {}

  async preview(dto: BroadcastPreviewDto): Promise<BroadcastPreviewResultDto> {
    const message = this.normalize(dto);
    const recipientsCount = await this.count(message.audience);
    return {
      ...message,
      recipientsCount,
      previewToken: this.token(message, recipientsCount),
    };
  }

  async send(
    dto: BroadcastSendDto,
    actorId?: string | null,
  ): Promise<BroadcastDto> {
    const existing = await this.broadcasts.findOneBy({
      previewToken: dto.previewToken,
    });
    if (existing) return { ...this.toDto(existing), idempotent: true };

    const message = this.normalize(dto);
    const recipientsCount = await this.count(message.audience);
    if (this.token(message, recipientsCount) !== dto.previewToken) {
      throw new ConflictException(
        'Xabar yoki qabul qiluvchilar soni ko‘rib chiqilgandan keyin o‘zgardi — qayta ko‘rib chiqing',
      );
    }
    if (recipientsCount === 0) {
      throw new BadRequestException('Tanlangan guruhda qabul qiluvchi yo‘q');
    }

    let saved: Broadcast;
    try {
      saved = await this.broadcasts.save(
        this.broadcasts.create({
          ...message,
          recipientsCount,
          previewToken: dto.previewToken,
          status: 'QUEUED',
          createdBy: actorId ? String(actorId) : null,
        }),
      );
    } catch (error) {
      // Parallel ikkinchi so'rov bir xil token bilan — birinchisini qaytaramiz.
      const raced =
        error instanceof QueryFailedError &&
        (error as QueryFailedError & { code?: string }).code === '23505'
          ? await this.broadcasts.findOneBy({ previewToken: dto.previewToken })
          : null;
      if (raced) return { ...this.toDto(raced), idempotent: true };
      throw error;
    }
    // Javob darhol qaytadi; yuborish fonda. Xato servisni yiqitmasin — cron qayta oladi.
    void this.process(saved.id).catch((error: unknown) =>
      this.logger.error(
        `Ommaviy xabar ${saved.id} boshlanmadi: ${String(error)}`,
      ),
    );
    return this.toDto(saved);
  }

  async list(query: BroadcastsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const [rows, total] = await this.broadcasts.findAndCount({
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return {
      items: rows.map((row) => this.toDto(row)),
      total,
      page,
      limit,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit),
    };
  }

  /** To'xtab qolgan (servis qayta ishga tushgan / identity xatosi) xabarlarni davom ettiradi. */
  @Cron(CronExpression.EVERY_MINUTE)
  async resumeStale(): Promise<void> {
    const stale = await this.broadcasts.find({
      select: { id: true },
      where: {
        status: In(['QUEUED', 'SENDING']),
        updatedAt: LessThan(new Date(Date.now() - BROADCAST_STALE_MS)),
      },
      take: 10,
    });
    for (const row of stale) await this.process(row.id);
  }

  async process(id: string): Promise<void> {
    if (this.running.has(id)) return;
    // Bir vaqtda faqat bitta ishchi: QUEUED yoki to'xtab qolgan SENDING olinadi.
    const claimed = await this.broadcasts
      .createQueryBuilder()
      .update()
      .set({ status: 'SENDING' })
      .where('id = :id', { id })
      .andWhere(
        `(status = 'QUEUED' OR (status = 'SENDING' AND updated_at < :staleBefore))`,
        { staleBefore: new Date(Date.now() - BROADCAST_STALE_MS) },
      )
      .execute();
    if (!claimed.affected) return;
    this.running.add(id);
    try {
      await this.run(id);
    } finally {
      this.running.delete(id);
    }
  }

  private async run(id: string): Promise<void> {
    const broadcast = await this.broadcasts.findOneByOrFail({ id });
    let cursor = broadcast.cursor;
    const channels = broadcast.channels.map((channel) => CHANNELS[channel]);
    try {
      for (;;) {
        const page = await sendRpc<RecipientsPage>(
          this.identity,
          { cmd: 'identity.broadcast.recipients' },
          {
            audience: broadcast.audience,
            afterId: cursor,
            limit: BROADCAST_BATCH,
          },
        );
        for (const recipient of page.items) {
          await this.notifications.create({
            recipient: {
              userId: recipient.id,
              phone: recipient.phone,
              email: recipient.email,
              channels,
            },
            type: 'broadcast',
            title: broadcast.title,
            body: broadcast.body,
            data: { broadcastId: id },
          });
        }
        if (page.items.length) cursor = page.items[page.items.length - 1].id;
        // Har bo'lakdan keyin kursor va hisob — uzilsa shu joydan davom etadi.
        await this.broadcasts.update(id, {
          cursor,
          sentCount: () => `sent_count + ${page.items.length}`,
          attempts: 0,
          lastError: null,
        });
        if (!page.nextAfterId) break;
      }
      await this.broadcasts.update(id, {
        status: 'DONE',
        finishedAt: new Date(),
      });
    } catch (error) {
      const message = String((error as Error)?.message ?? error).slice(0, 2000);
      const attempts = broadcast.attempts + 1;
      const failed = attempts >= BROADCAST_MAX_ATTEMPTS;
      // SENDING qoladi — cron to'xtagan joydan qayta urinadi; chegaradan keyin FAILED.
      await this.broadcasts.update(id, {
        attempts,
        lastError: message,
        ...(failed
          ? { status: 'FAILED' as const, finishedAt: new Date() }
          : {}),
      });
      this.logger.warn(
        `Ommaviy xabar ${id} (${attempts}-urinish) to‘xtadi: ${message}`,
      );
    }
  }

  private async count(audience: BroadcastAudience): Promise<number> {
    const { count } = await sendRpc<{ count: number }>(
      this.identity,
      { cmd: 'identity.broadcast.count' },
      { audience },
    );
    return Number(count);
  }

  private normalize(dto: BroadcastPreviewDto): BroadcastMessage {
    const title = dto.title.trim();
    const body = dto.body.trim();
    if (!title || !body)
      throw new BadRequestException('Sarlavha va matn bo‘sh bo‘lmasin');
    return {
      audience: dto.audience,
      channels: [...new Set(dto.channels ?? [])].sort(),
      title,
      body,
    };
  }

  /** Xabar + qabul qiluvchilar soni barmoq izi (maxfiy emas — mos kelishni tekshiradi). */
  private token(message: BroadcastMessage, recipientsCount: number): string {
    return createHash('sha256')
      .update(
        JSON.stringify([
          message.audience,
          message.channels,
          message.title,
          message.body,
          recipientsCount,
        ]),
      )
      .digest('hex');
  }

  private toDto(row: Broadcast): BroadcastDto {
    return {
      id: String(row.id),
      audience: row.audience,
      channels: row.channels ?? [],
      title: row.title,
      body: row.body,
      recipientsCount: Number(row.recipientsCount),
      sentCount: Number(row.sentCount),
      status: row.status,
      createdBy: row.createdBy ? String(row.createdBy) : null,
      createdAt: new Date(row.createdAt).toISOString(),
      finishedAt: row.finishedAt
        ? new Date(row.finishedAt).toISOString()
        : null,
      lastError: row.lastError ?? null,
    };
  }
}
