import {
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  ErrorCode,
  ORDER_SMS_TYPES,
  OrderSmsDto,
  OrderSmsState,
  OrderSmsType,
} from '@app/common';
import {
  DeliveryStatus,
  NotificationChannel,
} from './entities/notification-delivery.entity';
import { Notification } from './entities/notification.entity';
import { NotificationService } from './notification.service';

const ID = /^[1-9]\d{0,18}$/;

interface ResendInput {
  orderId: string;
  template: string;
  actorId: string;
}

interface SmsRow {
  type: OrderSmsType;
  title: string;
  body: string;
  data: Record<string, unknown>;
  dedupeKey: string | null;
  createdAt: Date;
  status: DeliveryStatus | null;
  sentAt: Date | null;
  phone: string | null;
}

/**
 * BE-25 (FE-26): buyurtmaning mijoz SMS lari (BE-24 avtomatik va qo‘lda qayta yuborilganlari). Qayta yuborish — o‘sha
 * matn va o‘sha raqamga yangi xabar; holat o‘zgarmaydi. Shu SMS hali navbatda bo‘lsa — 409 (bitta matn ikki marta ketmasin).
 */
@Injectable()
export class OrderSmsJournalService {
  constructor(
    @InjectRepository(Notification)
    private readonly repository: Repository<Notification>,
    private readonly notifications: NotificationService,
  ) {}

  async list(orderId: string): Promise<OrderSmsDto[]> {
    return this.view(await this.rows(this.id(orderId)));
  }

  async resend(input: ResendInput): Promise<OrderSmsDto> {
    const orderId = this.id(input?.orderId);
    // ikki admin bir vaqtda bossa — bitta SMS: ikkinchisi 409 (qulf tranzaksiya oxirida bo‘shaydi)
    return this.repository.manager.transaction(async (manager) => {
      const [{ locked }] = (await manager.query(
        `SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS locked`,
        [`order-sms:${orderId}`],
      )) as Array<{ locked: boolean }>;
      if (!locked) throw this.busy('Bu SMS hozir yuborilmoqda');
      return this.send(orderId, input);
    });
  }

  private async send(
    orderId: string,
    input: ResendInput,
  ): Promise<OrderSmsDto> {
    const rows = await this.rows(orderId);
    const wanted = String(input.template ?? '').trim();
    const journal = this.view(rows);
    const type =
      ORDER_SMS_TYPES.find((code) => code === wanted) ??
      journal.find((item) => item.title === wanted)?.template;
    const same = rows.filter((row) => row.type === type);
    const original = same[0];
    if (!original?.phone)
      throw new NotFoundException('Bu SMS mijozga hali yuborilmagan');
    if (same.some((row) => stateOf(row.status) === 'PENDING'))
      throw this.busy('Bu SMS hali yuborish navbatida');
    const count = same.length;
    const notification = await this.notifications.create({
      recipient: {
        userId: null,
        phone: original.phone,
        channels: [NotificationChannel.SMS],
      },
      type: original.type,
      title: original.title,
      body: original.body,
      data: {
        ...original.data,
        resend: count,
        resentBy: String(input.actorId ?? ''),
      },
      dedupeKey: `order:${orderId}:${original.type}:resend:${count}`,
    });
    const sent = this.view(await this.rows(orderId)).filter(
      (item) => item.template === type,
    )[count];
    if (!sent || sent.state === 'FAILED')
      throw new ServiceUnavailableException(
        `SMS yuborilmadi — SMS xizmati sozlanmagan (xabar #${notification.id})`,
      );
    return sent;
  }

  private busy(message: string) {
    return new ConflictException({
      message,
      errorCode: ErrorCode.INVALID_STATE,
    });
  }

  /** Eskisi birinchi. SMS yetkazish qatori yo‘q xabar ham ko‘rinadi (yuborilmagan). */
  private rows(orderId: string): Promise<SmsRow[]> {
    return this.repository.query(
      `SELECT n.type, n.title, n.body, n.data, n.dedupe_key AS "dedupeKey", n.created_at AS "createdAt",
              d.status, d.sent_at AS "sentAt", d.recipient AS phone
         FROM notification.notification n
         LEFT JOIN notification.notification_delivery d
           ON d.notification_id = n.id AND d.channel = 'sms'
        WHERE n.user_id IS NULL AND n.data->>'orderId' = $1 AND n.type = ANY($2)
        ORDER BY n.id`,
      [orderId, [...ORDER_SMS_TYPES]],
    ) as Promise<SmsRow[]>;
  }

  private view(rows: SmsRow[]): OrderSmsDto[] {
    const seen = new Map<OrderSmsType, number>();
    return rows.map((row) => {
      const n = seen.get(row.type) ?? 0;
      seen.set(row.type, n + 1);
      const state = stateOf(row.status);
      const at = row.sentAt ?? row.createdAt;
      return {
        template: row.type,
        // sarlavha har qatorda boshqa: frontend shu bo‘yicha tanlaydi
        title:
          n === 0
            ? row.title
            : `${row.title} — qayta yuborildi${n > 1 ? ` (${n})` : ''}`,
        at: at ? new Date(at).toISOString() : null,
        detail:
          state === 'PENDING'
            ? 'yuborish navbatida'
            : state === 'FAILED'
              ? 'yuborilmadi'
              : null,
        state,
      };
    });
  }

  private id(value: unknown): string {
    const id = String(value ?? '');
    if (!ID.test(id)) throw new NotFoundException('Buyurtma topilmadi');
    return id;
  }
}

function stateOf(status: DeliveryStatus | null): OrderSmsState {
  if (status === DeliveryStatus.SENT) return 'SENT';
  if (
    status === DeliveryStatus.PENDING ||
    status === DeliveryStatus.PROCESSING ||
    status === DeliveryStatus.RETRY
  )
    return 'PENDING';
  return 'FAILED';
}
