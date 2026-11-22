import { LeadOrderStatus, OrderStatusChangedEvent } from '@app/common';
import { customerSmsText, withdrawalPaidText } from './order-sms';

const event = (over: Partial<OrderStatusChangedEvent> = {}) =>
  ({
    orderId: '1284',
    orderNumber: 'L-1284',
    status: LeadOrderStatus.CONFIRMED,
    recipient: {
      phone: '+998901234567',
      whereDeliver: 'CENTER',
      regionSoato: '1730',
      districtSoato: '1730401',
    },
    items: [{ name: 'Simsiz quloqchinlar', quantity: 1, salePrice: 262000 }],
    delivery: { mode: 'PARTIAL', cost: 30000 },
    codAmount: 292000,
    parcel: null,
    ...over,
  }) as unknown as OrderStatusChangedEvent;

describe('BE-24: SMS matnlari (dizayn taxtalari bilan bir xil)', () => {
  it('TC1 tasdiqlandi — qisman rejim, markazgacha (xabar-mijoz-tasdiqlandi 2-holat)', () => {
    expect(customerSmsText(event(), 'Qo‘qon shahri')?.body).toBe(
      'Buyurtmangiz tasdiqlandi: Simsiz quloqchinlar, jami 292 000 so‘m (tovar 262 000 + yetkazish 30 000). Qo‘qon shahri markazigacha yetkaziladi. To‘lov tovarni olganingizda. Buyurtma L-1284.',
    );
  });

  it('tasdiqlandi — bepul yetkazish va eshikkacha', () => {
    expect(
      customerSmsText(
        event({
          delivery: { mode: 'FREE', cost: 0 } as never,
          codAmount: 294000,
          recipient: { ...event().recipient, whereDeliver: 'ADDRESS' } as never,
        }),
        'Qarshi shahri',
      )?.body,
    ).toBe(
      'Buyurtmangiz tasdiqlandi: Simsiz quloqchinlar, jami 294 000 so‘m, yetkazish bepul. Qarshi shahri bo‘yicha eshikkacha yetkaziladi. To‘lov tovarni olganingizda. Buyurtma L-1284.',
    );
  });

  it('TC2 yo‘lga chiqdi — trek bilan (xabar-mijoz-yolda)', () => {
    expect(
      customerSmsText(
        event({
          status: LeadOrderStatus.IN_TRANSIT,
          parcel: { shipmentId: '1251131', trackingUrl: null },
        }),
        'Quvasoy shahri',
      )?.body,
    ).toBe(
      'Posilka yo‘lga chiqdi. Trek raqami: 1251131. Buyurtma L-1284, Simsiz quloqchinlar. Elchi Pochta Quvasoy shahri markazigacha yetkazadi. To‘lov olganingizda: 292 000 so‘m.',
    );
    // joy nomi olinmasa — joysiz, kichik harf bilan
    expect(
      customerSmsText(event({ status: LeadOrderStatus.IN_TRANSIT }), null)
        ?.body,
    ).toContain('Elchi Pochta markazgacha yetkazadi.');
  });

  it('TC3 yetkazildi; boshqa holatlar — SMS yo‘q', () => {
    expect(
      customerSmsText(event({ status: LeadOrderStatus.DELIVERED }), null)?.body,
    ).toBe(
      'Buyurtma L-1284 yetkazildi: Simsiz quloqchinlar. Xaridingiz uchun rahmat!',
    );
    expect(
      customerSmsText(event({ status: LeadOrderStatus.PICKING }), null),
    ).toBeNull();
  });

  it('TC4 pul o‘tkazildi (xabar-pul)', () => {
    expect(
      withdrawalPaidText({
        withdrawalId: '5',
        affiliateId: '42',
        amount: 6000000,
        tax: 60000,
        net: 5940000,
      }),
    ).toBe(
      'Pul kartangizga o‘tkazildi: 5 940 000 so‘m. So‘rov 6 000 000 so‘m, 1% soliq 60 000 so‘m.',
    );
  });
});
