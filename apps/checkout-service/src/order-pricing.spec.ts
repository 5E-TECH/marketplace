import {
  calculatePrice,
  DeliveryDisplayMode,
  evaluatePrice,
  TZ_DEFAULT_ELCHI_TARIFF,
  TZ_DEFAULT_PRICING,
} from '@app/common';
import { orderPricing, OrderPricingSource } from './order-pricing';

/**
 * FE-26: narx nusxasi — catalog `orderPricing` yozadigan nusxadan (haqiqiy kalkulyator bilan). Dizayn DZ-05
 * (`admin-buyurtma-karta`): tavsiya 251 000, qisman rejimda 262 000, yashirilgan 10 000 → narxga +11 000,
 * taqsimot 140 000 / 65 000 / 12 000 / 34 000 (asos 251 000).
 */
describe('orderPricing (FE-26)', () => {
  const build = (
    mode: DeliveryDisplayMode,
    over: { quantity?: number; markup?: number; whereDeliver?: string } = {},
  ): OrderPricingSource => {
    const params = { ...TZ_DEFAULT_PRICING, deliveryMode: mode };
    const calc = calculatePrice(params, TZ_DEFAULT_ELCHI_TARIFF, {
      basePrice: 140_000,
      affiliateFee: 65_000,
      weightGrams: 300,
    });
    const approved = calc.recommended;
    const { split } = evaluatePrice(params, calc, approved);
    const markup = over.markup ?? 0;
    const tariff = 40_000;
    return {
      sellerOrders: [
        {
          items: [
            {
              unitPrice: approved + markup,
              quantity: over.quantity ?? 1,
              priceSnapshot: {
                basePrice: calc.basePrice,
                recommendedPrice: calc.recommended,
                approvedPrice: approved,
                markup,
                affiliateFee: split.affiliate,
                callCenterFee: split.callCenter,
                hiddenDelivery: split.hiddenDelivery,
                platformService: split.platformService,
              },
            },
          ],
        },
      ],
      lead: {
        deliveryMode: mode,
        whereDeliver: over.whereDeliver ?? 'CENTER',
        deliveryShown: calc.delivery.visibleCenter,
        deliveryCost: tariff,
      },
    };
  };

  it('qisman rejim (dizayn namunasi): tavsiya alohida rejimda, yashirilgan va narxga qo‘shimcha, taqsimot', () => {
    expect(orderPricing(build(DeliveryDisplayMode.PARTIAL))).toEqual({
      salePrice: 262_000,
      approvedPrice: 262_000,
      markup: 0,
      recommendedPrice: 251_000,
      recommendedModePrice: 262_000,
      approvedAt: null,
      deliveryMode: 'PARTIAL',
      hiddenDelivery: 10_000,
      priceAdd: 11_000,
      visibleCenter: 30_000,
      visibleAddress: null,
      elchiTariff: 40_000,
      split: {
        wholesaler: 140_000,
        affiliate: 65_000,
        callCenter: 12_000,
        platformService: 34_000,
      },
    });
  });

  it('2 dona va ustama: taqsimot jami; Σ taqsimot + qo‘shimcha × soni = tasdiqlangan × soni (moliya bilan bir xil)', () => {
    const p = orderPricing(
      build(DeliveryDisplayMode.PARTIAL, { quantity: 2, markup: 25_000 }),
    )!;
    expect(p).toMatchObject({
      salePrice: 287_000,
      approvedPrice: 262_000,
      markup: 25_000,
      split: {
        wholesaler: 280_000,
        affiliate: 130_000,
        callCenter: 24_000,
        platformService: 68_000,
      },
    });
    const sum = Object.values(p.split).reduce((a, b) => a + b, 0);
    expect(sum + p.priceAdd * 2).toBe(p.approvedPrice * 2);
  });

  it('eshikkacha — `visibleAddress`, markazgacha saqlanmagan (null)', () => {
    expect(
      orderPricing(
        build(DeliveryDisplayMode.PARTIAL, { whereDeliver: 'ADDRESS' }),
      ),
    ).toMatchObject({ visibleCenter: null, visibleAddress: 30_000 });
  });

  it('alohida rejim: qo‘shimcha 0, ikki tavsiya teng, yashirilgan 0', () => {
    const p = orderPricing(build(DeliveryDisplayMode.SEPARATE))!;
    expect(p.priceAdd).toBe(0);
    expect(p.recommendedPrice).toBe(p.recommendedModePrice);
    expect(p.recommendedPrice).toBe(251_000);
    expect(p.hiddenDelivery).toBe(0);
  });

  it('nusxasiz qator yoki lidsiz (eski) buyurtma — null', () => {
    const order = build(DeliveryDisplayMode.PARTIAL);
    expect(orderPricing({ ...order, lead: null })).toBeNull();
    order.sellerOrders[0].items.push({
      unitPrice: 1,
      quantity: 1,
      priceSnapshot: null,
    });
    expect(orderPricing(order)).toBeNull();
  });
});
