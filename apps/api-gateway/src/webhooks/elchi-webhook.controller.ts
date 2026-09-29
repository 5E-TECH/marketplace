import {
  Controller,
  Headers,
  Inject,
  Post,
  RawBodyRequest,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientProxy } from '@nestjs/microservices';
import { ApiBody, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import {
  ElchiWebhookDto,
  normalizeElchiWebhook,
  Public,
  rawResponse,
  RmqClient,
  sendRpc,
  verifyHmacSha256,
} from '@app/common';

/**
 * Kelajak tomonga oyna — faqat soatlar farqini qoplaydi. Tor qoladi:
 * kelajakdagi vaqt bilan imzolangan tana takroriy hujum uchun oyna ochadi.
 */
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

/**
 * O'tmish tomonga oyna — Elchi outbox'ining QAYTA URINISHLARI uchun.
 *
 * `occurred_at` navbatga qo'yish paytida qotiriladi, outbox esa 1m/5m/15m
 * backoff bilan 4 marta uradi (~21 daqiqa). Ilgari bu yerda ikki tomonga ham
 * 5 daqiqa turardi — ya'ni 3- va 4-urinish 401 olardi va hodisa
 * `permanently_failed` bo'lib butunlay yo'qolardi. Bir soat butun retry
 * zanjirini zaxirasi bilan qoplaydi.
 *
 * Takroriy hujumdan himoya bu oynaga TAYANMAYDI: `checkout.elchi_webhook_event`
 * da `event_id` birlamchi kalit, ya'ni bir hodisa ikki marta qayta ishlanmaydi.
 */
const MAX_PAST_SKEW_MS = 60 * 60 * 1000;

@ApiTags('webhooks')
@Public()
@Controller('webhooks/elchi')
export class ElchiWebhookController {
  constructor(
    @Inject(RmqClient.CHECKOUT) private readonly checkout: ClientProxy,
    private readonly config: ConfigService,
  ) {}

  @Post()
  @ApiOperation({
    summary: 'Elchi shipment status webhook receiver',
    description:
      'Tana Elchi shaklida (snake_case: `event_id`, `external_order_id`, ' +
      '`shipment_id`, `occurred_at`, Elchi status lug‘ati) ham, quyidagi ' +
      'normal shaklda ham qabul qilinadi — `normalizeElchiWebhook` ikkalasini ' +
      'bitta shaklga keltiradi. Elchi’ning ortiqcha moliyaviy maydonlari ' +
      'e’tiborsiz qoldiriladi. `webhook.test` ping’i va xaritalanmagan ' +
      'statuslar (`closed`, `paid`, `partly_paid`) 200 oladi, lekin hech ' +
      'qanday holat o‘zgarmaydi.',
  })
  @ApiHeader({ name: 'X-Elchi-Signature', required: true })
  // Faqat HUJJAT uchun: tana `@Body()` bilan bog‘lanmaydi (izohga qarang),
  // shuning uchun bu dekorator validatsiya qilmaydi — kontraktni saqlaydi.
  @ApiBody({ type: ElchiWebhookDto })
  async receive(
    @Req() request: RawBodyRequest<Request>,
    @Headers('x-elchi-signature') signature: string | undefined,
  ) {
    const secret = this.config.get<string>('ELCHI_WEBHOOK_SECRET');
    const rawBody = request.rawBody?.toString('utf8');
    if (!secret || !signature || !rawBody) {
      throw new UnauthorizedException('Webhook imzosi topilmadi');
    }
    if (!verifyHmacSha256(rawBody, signature, secret)) {
      throw new UnauthorizedException('Webhook imzosi noto‘g‘ri');
    }

    /*
     * Tana ATAYLAB `@Body()` orqali olinmaydi: global ValidationPipe
     * (main.ts, `forbidNonWhitelisted: true`) Elchi'ning snake_case va
     * ortiqcha moliyaviy maydonlari tufayli so'rovni IMZO TEKSHIRUVIDAN
     * OLDIN 400 bilan rad etardi. 2026-09-14 dagi 400'lar aynan shundan edi.
     * Endi: imzo -> normalizatsiya -> DTO tekshiruvi.
     */
    const { event, ignored } = normalizeElchiWebhook(request.body);
    if (ignored) {
      // 200 qaytaramiz — Elchi outbox'i qayta urinavermasin. Hech qanday
      // holat ham, pul ham qimirlamaydi (ELCHI_IGNORED_STATUSES izohiga qarang).
      return rawResponse({ received: true, ignored: ignored.status });
    }

    const occurredAt = Date.parse(event!.occurredAt);
    const drift = Date.now() - occurredAt;
    if (
      !Number.isFinite(occurredAt) ||
      drift > MAX_PAST_SKEW_MS ||
      -drift > MAX_FUTURE_SKEW_MS
    ) {
      throw new UnauthorizedException(
        'Webhook vaqti ruxsat etilgan oynadan tashqarida',
      );
    }

    const result = await sendRpc<{ received: true; duplicate?: boolean }>(
      this.checkout,
      { cmd: 'checkout.elchi-webhook.process' },
      event,
    );
    return rawResponse(result);
  }
}
