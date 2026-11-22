import {
  isLeadOrderTransitionAllowed,
  LEAD_ORDER_CANCELLABLE,
  LEAD_ORDER_TRANSITIONS,
  orderCodAmount,
} from './lead-order.dto';
import { LeadOrderStatus as S } from './order-events.dto';

describe('lid buyurtmasi holatlari (BE-18, TZ T5)', () => {
  it('T5 jadvali: har holatdan keyingi ruxsat etilgan holatlar', () => {
    expect(LEAD_ORDER_TRANSITIONS).toEqual({
      CONFIRMED: [S.PICKING, S.CANCELLED],
      PICKING: [S.PACKED, S.CANCELLED],
      PACKED: [S.HANDED_TO_ELCHI, S.CANCELLED],
      HANDED_TO_ELCHI: [S.IN_TRANSIT],
      IN_TRANSIT: [S.DELIVERED, S.REFUSED],
      DELIVERED: [S.REMITTED, S.RETURN_REQUESTED],
      REMITTED: [S.SETTLED],
      REFUSED: [S.RETURNING],
      RETURNING: [S.RETURNED_GRADED],
      // BE-44 [taklif]: tasdiq — qaytmoqda, rad — yetkazilgan
      RETURN_REQUESTED: [S.RETURNING, S.DELIVERED],
      SETTLED: [],
      RETURNED_GRADED: [],
      CANCELLED: [],
    });
  });

  it('TC2: Yetkazildi → Yo‘lda rad; BUY-3: bekor faqat topshirilgunga qadar', () => {
    expect(isLeadOrderTransitionAllowed(S.DELIVERED, S.IN_TRANSIT)).toBe(false);
    expect(isLeadOrderTransitionAllowed(S.CONFIRMED, S.DELIVERED)).toBe(false);
    for (const from of Object.values(S))
      expect([from, isLeadOrderTransitionAllowed(from, S.CANCELLED)]).toEqual([
        from,
        LEAD_ORDER_CANCELLABLE.includes(from),
      ]);
    expect(LEAD_ORDER_CANCELLABLE).toEqual([S.CONFIRMED, S.PICKING, S.PACKED]);
  });
});

describe('orderCodAmount (TZ T9-5: yagona COD hisobi)', () => {
  it('tovarlar + mijozga ko‘rinadigan yetkazish; oldindan to‘langan — 0', () => {
    expect(
      orderCodAmount({
        items: [{ unitPrice: 276_000, quantity: 2 }],
        deliveryFee: 34_000,
      }),
    ).toBe(586_000);
    expect(
      orderCodAmount({
        items: [{ unitPrice: 276_000, quantity: 1 }],
        deliveryFee: 30_000,
        prepaid: true,
      }),
    ).toBe(0);
  });

  it('butun so‘m emas yoki manfiy summa — xato', () => {
    expect(() =>
      orderCodAmount({
        items: [{ unitPrice: 10.5, quantity: 1 }],
        deliveryFee: 0,
      }),
    ).toThrow();
    expect(() =>
      orderCodAmount({
        items: [{ unitPrice: 0, quantity: 1 }],
        deliveryFee: -1,
      }),
    ).toThrow();
  });
});
