import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ElchiWebhookDto } from './elchi-webhook.dto';

/**
 * Elchi chiquvchi webhook tanasini marketplace DTO shakliga o'giradi.
 *
 * NEGA KERAK — C1.40 TC4 shu sabab yopilmay turgan edi. Ikki tomon ikki xil
 * shartnomada gaplashadi:
 *
 *   Elchi yuboradi (integration-service.service.ts -> enqueuePartnerWebhook):
 *     { event, event_id, external_order_id, shipment_id, status,
 *       cod_collected, market_paid_amount, collected_from_customer,
 *       elchi_fee, market_amount, cod_amount?, total_price?, extra_cost?,
 *       occurred_at }
 *
 *   Marketplace kutadi (ElchiWebhookDto):
 *     { eventId, type, shipmentId, externalOrderId, status, codCollected?,
 *       occurredAt }
 *
 * Uchta nomuvofiqlik bor edi va uchalasi ham 400 bilan tugardi:
 *   1. snake_case ↔ camelCase;
 *   2. status lug'ati boshqa (`on the road` vs `on_the_road`);
 *   3. api-gateway global ValidationPipe `forbidNonWhitelisted: true` —
 *      Elchi'ning ortiqcha moliyaviy maydonlari o'zi 400 berardi.
 * Ustiga ValidationPipe imzo tekshiruvidan OLDIN ishlaydi, shuning uchun
 * xatolik "imzo noto'g'ri" emas, "shakl noto'g'ri" bo'lib chiqardi.
 *
 * Tuzatish MARKETPLACE tomonida qilindi: Elchi'ning payload'i umumiy hamkor
 * shartnomasi (Beepost ham shu yo'ldan yuradi), uni o'zgartirish keng ta'sirli;
 * bizda esa bitta repo va avtodeploy bor.
 */

/**
 * Elchi `Order_status` -> marketplace webhook statusi.
 * Manba: Elchi-Backend/libs/common/enums/index.ts -> Order_status.
 *
 * ⚠️ Moliyaviy oqibatga E'TIBOR BERING (checkout/elchi-webhook.service.ts):
 *   - `sold` -> DELIVERED -> ONLINE to'lovda `finance.payout.requested`
 *     (COD'da hech narsa bo'lmaydi);
 *   - `cancelled`/`returned` -> ONLINE to'lovda refund, `returned` ustiga
 *     qoldiqni omborga qaytaradi.
 * Shuning uchun bu jadval kod ichida tarqoq emas, bitta joyda turadi.
 */
export const ELCHI_STATUS_ALIASES: Readonly<Record<string, string>> = {
  // — Yo'ldagi holatlar: moliyaviy oqibati yo'q —
  created: 'shipment_created',
  new: 'shipment_created',
  received: 'received',
  'on the road': 'on_the_road',
  on_the_road: 'on_the_road',
  // Filialda yoki mijoz javobini kutmoqda — hamon yo'lda, pul harakati yo'q.
  waiting: 'on_the_road',
  waiting_customer: 'on_the_road',

  // — Sotuv —
  // Faqat `sold` bir ma'noli: tovar sotilgan va hisob yopilgan
  // (Elchi'da `sold` ⟺ `paid_amount = 0`).
  sold: 'sold',

  // — Bekor qilish va qaytarish —
  cancelled: 'cancelled',
  canceled: 'cancelled',
  'cancelled (sent)': 'cancelled',
  returned_to_market: 'returned',
  returned: 'returned',
};

/**
 * ATAYLAB e'tiborsiz qoldiriladigan statuslar: 200 qaytariladi (Elchi outbox
 * qayta urinmasin), lekin buyurtma holati ham, pul ham QIMIRLAMAYDI.
 *
 * Uchalasi ham PUL bilan bog'liq va ma'no tengligi TASDIQLANMAGAN — noto'g'ri
 * xarita noto'g'ri pul harakati degani, shuning uchun biznes qarori kelguncha
 * tegmaymiz:
 *
 *   `closed`      -> bizning `settled` ga tushsa `finance.cod.settled` ni
 *                    uyg'otadi va COD hisob-kitobini `collectedAmount`
 *                    bo'yicha YOPADI.
 *   `partly_paid` -> `sold` ga tushsa DELIVERED bo'ladi; naqd bo'lmagan
 *                    buyurtmada `finance.payout.requested` TO'LIQ subtotal
 *                    bilan otiladi, holbuki pul QISMAN to'langan.
 *   `paid`        -> Elchi lug'atida bu Elchi↔market hisob-kitobini
 *                    bildiradi, xaridor to'lovini emas; `sold` bilan tenglashi
 *                    tekshirilmagan.
 *
 * Qaror qabul qilingach qiymatni shu to'plamdan `ELCHI_STATUS_ALIASES` ga
 * ko'chirish kifoya — boshqa hech qayerga tegmaydi.
 */
export const ELCHI_IGNORED_STATUSES: ReadonlySet<string> = new Set([
  'closed',
  'paid',
  'partly_paid',
]);

/**
 * Elchi'ning NOL TA'SIRLI diagnostika vositasi: hamkor panelidagi «sinov
 * webhooki» tugmasi (`testPartnerWebhook`) haqiqiy imzo bilan, lekin
 * `event: 'webhook.test'`, `test: true` va `status` maydonisiz POST yuboradi.
 * Outbox'ga qator yozmaydi, buyurtmaga tegmaydi.
 *
 * Bu — SIR TENGLIGINI jonli isbotlashning yagona xavfsiz yo'li, shuning uchun
 * uni 400 bilan rad etmaymiz: 200 qaytaramiz va hech narsa qilmaymiz.
 */
function isTestPing(raw: Record<string, unknown>): boolean {
  return (
    raw.test === true || asString(pick(raw, 'type', 'event')) === 'webhook.test'
  );
}

/** `seller-order-9` kabi eski shakldan sof id ajratib olinadi. */
const SELLER_ORDER_PREFIX = /^seller-order-/i;

function pick(raw: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    const value = raw[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : String(value ?? '');
}

export interface NormalizedElchiWebhook {
  /** Xaritalangan hodisa; `ignored` bo'lsa `undefined`. */
  event?: ElchiWebhookDto;
  /** Status ataylab e'tiborsiz qoldirilgan (200 qaytariladi, ish bajarilmaydi). */
  ignored?: { status: string; eventId: string };
}

/**
 * Elchi (snake_case) yoki marketplace (camelCase) shaklidagi tanani qabul
 * qiladi va normal DTO qaytaradi. Faqat DTO maydonlari o'tkaziladi — Elchi'ning
 * ortiqcha moliyaviy maydonlari shu yerda tushib qoladi, shuning uchun
 * `forbidNonWhitelisted` endi to'siq emas.
 *
 * Noma'lum status -> BadRequestException (jimgina yutib yubormaymiz: yangi
 * Elchi statusi paydo bo'lsa biz buni BILISHIMIZ kerak).
 */
export function normalizeElchiWebhook(body: unknown): NormalizedElchiWebhook {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new BadRequestException('Webhook tanasi obyekt bo‘lishi kerak');
  }
  const raw = body as Record<string, unknown>;

  const eventId = asString(pick(raw, 'eventId', 'event_id')).trim();
  if (!eventId) {
    throw new BadRequestException('Webhook `event_id` maydoni yo‘q');
  }

  // Sinov ping'i statussiz keladi — status tekshiruvidan OLDIN ushlanadi.
  if (isTestPing(raw)) {
    return { ignored: { status: 'webhook.test', eventId } };
  }

  const rawStatus = asString(pick(raw, 'status')).trim().toLowerCase();
  if (!rawStatus) {
    throw new BadRequestException('Webhook `status` maydoni yo‘q');
  }
  if (ELCHI_IGNORED_STATUSES.has(rawStatus)) {
    return { ignored: { status: rawStatus, eventId } };
  }
  const status = ELCHI_STATUS_ALIASES[rawStatus];
  if (!status) {
    throw new BadRequestException(
      `Elchi statusi qo‘llab-quvvatlanmaydi: ${rawStatus}`,
    );
  }

  // `event` — Elchi nomi, `type` — bizniki. Elchi hozircha faqat
  // `shipment.status_changed` yuboradi.
  const type = asString(
    pick(raw, 'type', 'event') ?? 'shipment.status_changed',
  ).trim();

  const shipmentId = asString(pick(raw, 'shipmentId', 'shipment_id')).trim();

  // Eski posilkalar Elchi'da `seller-order-9` shaklida ro'yxatdan o'tgan
  // (seller-orders.service.ts o'sha paytda shunday yozardi). Prefiksni shu
  // yerda yechamiz, aks holda DTO regex'i ham, `WHERE s.id=$1` ham mos kelmaydi.
  const externalOrderId = asString(
    pick(raw, 'externalOrderId', 'external_order_id'),
  )
    .trim()
    .replace(SELLER_ORDER_PREFIX, '');

  const occurredAt = asString(pick(raw, 'occurredAt', 'occurred_at')).trim();

  /*
   * `collected_from_customer` — kuryer mijozdan yig'gan haqiqiy naqd.
   * `cod_collected` esa Elchi'ning O'Z izohida "nomi yolg'on" deb belgilangan
   * eski maydon (u `paid_amount`ni tashiydi). Shuning uchun avval
   * `collected_from_customer` olinadi.
   */
  const codCollectedRaw = pick(
    raw,
    'codCollected',
    'collected_from_customer',
    'cod_collected',
  );
  const codCollected =
    codCollectedRaw === undefined ? undefined : Number(codCollectedRaw);

  const event: ElchiWebhookDto = {
    eventId,
    type,
    shipmentId,
    externalOrderId,
    status: status as ElchiWebhookDto['status'],
    occurredAt,
    ...(codCollected !== undefined && Number.isFinite(codCollected)
      ? { codCollected }
      : {}),
  };

  // O'girishdan KEYIN baribir DTO qoidalari qo'llanadi (regex, sana, enum).
  // Global ValidationPipe bu marshrutda ishlamaydi — tana xom holda o'qiladi,
  // chunki imzo aynan xom tana ustidan tekshiriladi. Ya'ni tekshiruv shu
  // yerda bo'lmasa, umuman bo'lmaydi.
  const errors = validateSync(plainToInstance(ElchiWebhookDto, event), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  if (errors.length) {
    const detail = errors
      .map(
        (e) =>
          `${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`,
      )
      .join('; ');
    throw new BadRequestException(`Webhook tanasi noto‘g‘ri — ${detail}`);
  }
  return { event };
}
