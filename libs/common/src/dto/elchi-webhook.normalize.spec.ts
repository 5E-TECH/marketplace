import { BadRequestException } from '@nestjs/common';
import {
  ELCHI_IGNORED_STATUSES,
  ELCHI_STATUS_ALIASES,
  normalizeElchiWebhook,
} from './elchi-webhook.normalize';

/**
 * Elchi'ning HAQIQIY chiquvchi tanasi.
 * Manba: Elchi-Backend/apps/integration-service/src/integration-service.service.ts
 * -> enqueuePartnerWebhook (payload obyekti). Maydonlar tartibi va nomlari
 * aynan o'sha yerdan olingan — test shu bilan "shartnoma testi" vazifasini
 * bajaradi: Elchi tomoni shaklni o'zgartirsa, bu test qizil bo'ladi.
 */
function elchiBody(overrides: Record<string, unknown> = {}) {
  return {
    event: 'shipment.status_changed',
    event_id: '0f1d3c5e-7a9b-4c2d-8e6f-1a2b3c4d5e6f',
    external_order_id: '11',
    shipment_id: '1251134',
    status: 'on the road',
    cod_collected: 0,
    market_paid_amount: 0,
    collected_from_customer: null,
    elchi_fee: null,
    market_amount: null,
    occurred_at: '2026-09-21T10:00:00.000Z',
    ...overrides,
  };
}

describe('normalizeElchiWebhook', () => {
  it('Elchi tanasini qabul qiladi va statusni o‘giradi (C1.40 TC4)', () => {
    const { event, ignored } = normalizeElchiWebhook(elchiBody());
    expect(ignored).toBeUndefined();
    expect(event).toEqual({
      eventId: '0f1d3c5e-7a9b-4c2d-8e6f-1a2b3c4d5e6f',
      type: 'shipment.status_changed',
      shipmentId: '1251134',
      externalOrderId: '11',
      status: 'on_the_road',
      occurredAt: '2026-09-21T10:00:00.000Z',
      codCollected: 0,
    });
  });

  it('Elchi’ning ortiqcha moliyaviy maydonlari tushib qoladi', () => {
    const { event } = normalizeElchiWebhook(
      elchiBody({ total_price: 450000, extra_cost: 15000, cod_amount: 45000 }),
    );
    for (const key of [
      'event',
      'total_price',
      'extra_cost',
      'cod_amount',
      'market_amount',
      'elchi_fee',
      'market_paid_amount',
      'collected_from_customer',
    ]) {
      expect(event).not.toHaveProperty(key);
    }
  });

  it('eski `seller-order-N` shaklidan sof id ajratadi', () => {
    const { event } = normalizeElchiWebhook(
      elchiBody({
        external_order_id: 'seller-order-9',
        shipment_id: '1251131',
      }),
    );
    expect(event?.externalOrderId).toBe('9');
  });

  it('faqat `sold` sotuv deb qabul qilinadi', () => {
    const { event } = normalizeElchiWebhook(elchiBody({ status: 'sold' }));
    expect(event?.status).toBe('sold');
  });

  it('`paid` va `partly_paid` e\u2019tiborsiz \u2014 noto\u2018g\u2018ri payout otilmaydi', () => {
    // `partly_paid` -> `sold` -> DELIVERED bo'lsa, naqd bo'lmagan buyurtmada
    // `finance.payout.requested` TO'LIQ subtotal bilan otilardi.
    for (const raw of ['paid', 'partly_paid']) {
      const { event, ignored } = normalizeElchiWebhook(
        elchiBody({ status: raw }),
      );
      expect(event).toBeUndefined();
      expect(ignored?.status).toBe(raw);
    }
  });

  it('Elchi\u2019ning sinov ping\u2019i (webhook.test) 200 bilan e\u2019tiborsiz qoldiriladi', () => {
    // Manba: Elchi-Backend integration-service `testPartnerWebhook` \u2014 statussiz,
    // haqiqiy imzo bilan. Bu sir tengligini isbotlashning yagona nol ta'sirli yo'li,
    // shuning uchun 400 berish MUMKIN EMAS.
    const { event, ignored } = normalizeElchiWebhook({
      event: 'webhook.test',
      event_id: 'b2c3d4e5-0000-4000-8000-111122223333',
      test: true,
      partner_id: '2',
      message: 'Elchi sinov webhooki',
      occurred_at: new Date().toISOString(),
    });
    expect(event).toBeUndefined();
    expect(ignored?.status).toBe('webhook.test');
  });

  it('`cancelled (sent)` va `returned_to_market` xaritalanadi', () => {
    expect(
      normalizeElchiWebhook(elchiBody({ status: 'cancelled (sent)' })).event
        ?.status,
    ).toBe('cancelled');
    expect(
      normalizeElchiWebhook(elchiBody({ status: 'returned_to_market' })).event
        ?.status,
    ).toBe('returned');
  });

  it('`collected_from_customer` `cod_collected` dan ustun (nomi yolg‘on maydon)', () => {
    const { event } = normalizeElchiWebhook(
      elchiBody({ collected_from_customer: 450000, cod_collected: 0 }),
    );
    expect(event?.codCollected).toBe(450000);
  });

  it('`closed` ataylab e’tiborsiz qoldiriladi — pul harakati boshlanmaydi', () => {
    const { event, ignored } = normalizeElchiWebhook(
      elchiBody({ status: 'closed' }),
    );
    expect(event).toBeUndefined();
    expect(ignored?.status).toBe('closed');
    expect(ELCHI_IGNORED_STATUSES.has('closed')).toBe(true);
    expect(ELCHI_IGNORED_STATUSES.has('partly_paid')).toBe(true);
  });

  it('noma’lum status 400 beradi (jimgina yutilmaydi)', () => {
    expect(() =>
      normalizeElchiWebhook(elchiBody({ status: 'qwerty' })),
    ).toThrow(BadRequestException);
  });

  it('camelCase tana ham ishlaydi (o‘z asboblarimiz uchun)', () => {
    const { event } = normalizeElchiWebhook({
      eventId: 'evt_1',
      type: 'shipment.status_changed',
      shipmentId: '1251134',
      externalOrderId: '11',
      status: 'received',
      occurredAt: '2026-09-21T10:00:00.000Z',
    });
    expect(event?.status).toBe('received');
    expect(event?.eventId).toBe('evt_1');
  });

  it('DTO qoidalari o‘girishdan keyin ham qo‘llanadi', () => {
    // externalOrderId `^[1-9]\d*$` bo'lishi shart
    expect(() =>
      normalizeElchiWebhook(elchiBody({ external_order_id: 'abc' })),
    ).toThrow(BadRequestException);
    // occurred_at sana bo'lishi shart
    expect(() =>
      normalizeElchiWebhook(elchiBody({ occurred_at: 'kecha' })),
    ).toThrow(BadRequestException);
  });

  it('event_id yoki status yo‘q bo‘lsa 400', () => {
    expect(() => normalizeElchiWebhook(elchiBody({ event_id: '' }))).toThrow(
      BadRequestException,
    );
    expect(() => normalizeElchiWebhook(elchiBody({ status: '' }))).toThrow(
      BadRequestException,
    );
    expect(() => normalizeElchiWebhook(null)).toThrow(BadRequestException);
  });

  it('Elchi ROSTDAN yuboradigan statuslarning hammasi qamrab olingan', () => {
    /*
     * Elchi webhook signalini FAQAT `resolveSyncAction` null qaytarmagan
     * o'tishlarda chiqaradi:
     * Elchi-Backend/apps/order-service/src/lifecycle/order-lifecycle.service.ts
     * -> cancelled, cancelled (sent), paid, partly_paid, sold,
     *    returned_to_market, waiting, waiting_customer.
     * ⚠️ `received` va `on the road` HECH QACHON yuborilmaydi \u2014 ular uchun
     * Elchi tomonida alohida ish kerak (C1.40 izohiga qarang).
     */
    const elchiSignals = [
      'cancelled',
      'cancelled (sent)',
      'paid',
      'partly_paid',
      'sold',
      'returned_to_market',
      'waiting',
      'waiting_customer',
    ];
    const uncovered = elchiSignals.filter(
      (s) => !ELCHI_STATUS_ALIASES[s] && !ELCHI_IGNORED_STATUSES.has(s),
    );
    expect(uncovered).toEqual([]);
  });

  it('xarita Elchi Order_status lug‘atini to‘liq qoplaydi', () => {
    // Manba: Elchi-Backend/libs/common/enums/index.ts -> Order_status
    const elchiStatuses = [
      'created',
      'new',
      'received',
      'on the road',
      'waiting',
      'waiting_customer',
      'sold',
      'cancelled',
      'returned_to_market',
      'paid',
      'partly_paid',
      'cancelled (sent)',
      'closed',
    ];
    const uncovered = elchiStatuses.filter(
      (s) => !ELCHI_STATUS_ALIASES[s] && !ELCHI_IGNORED_STATUSES.has(s),
    );
    expect(uncovered).toEqual([]);
  });
});
