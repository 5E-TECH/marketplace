import { orderEvent } from './order-events.samples';
import { SplitError, SplitLine, splitDelivered } from './split';

const view = (lines: SplitLine[]) =>
  Object.fromEntries(
    lines.map((l) => [
      `${l.account}${l.ownerId ? ':' + l.ownerId : ''}/${l.lineKind}`,
      l.amount,
    ]),
  );

describe('splitDelivered (BE-22)', () => {
  it('TC1: 251 000 → optovik 140 000, sotuvchi 65 000, qo‘ng‘iroq markazi 12 000, platforma 34 000', () => {
    expect(view(splitDelivered(orderEvent()))).toEqual({
      'WHOLESALER:W/WHOLESALER_BASE': 140000,
      'AFFILIATE:A/AFFILIATE_FEE': 65000,
      'CALL_CENTER/CALL_CENTER_FEE': 12000,
      'PLATFORM_SERVICE/PLATFORM_SERVICE': 34000,
      'COD_CLEARING/COD_RECEIVABLE': -251000,
    });
  });

  it('TC6: sotuv 276 000 → sotuvchi 65 000 + 21 250, platforma 34 000 + 3 750; optovik va markaz o‘zgarmaydi', () => {
    const lines = view(splitDelivered(orderEvent({}, { salePrice: 276000 })));
    expect(lines).toEqual({
      'WHOLESALER:W/WHOLESALER_BASE': 140000,
      'AFFILIATE:A/AFFILIATE_FEE': 65000,
      'AFFILIATE:A/AFFILIATE_MARKUP': 21250,
      'CALL_CENTER/CALL_CENTER_FEE': 12000,
      'PLATFORM_SERVICE/PLATFORM_SERVICE': 34000,
      'PLATFORM_SERVICE/PLATFORM_MARKUP': 3750,
      'COD_CLEARING/COD_RECEIVABLE': -276000,
    });
  });

  it('TC7: 85% butun chiqmasa sotuvchiga butun so‘m, qoldiq platformaga; yig‘indi = sotuv narxi', () => {
    const lines = view(splitDelivered(orderEvent({}, { salePrice: 276010 })));
    expect(lines['AFFILIATE:A/AFFILIATE_MARKUP']).toBe(21258);
    expect(lines['PLATFORM_SERVICE/PLATFORM_MARKUP']).toBe(3752);
    const one = view(splitDelivered(orderEvent({}, { salePrice: 251001 })));
    expect(one['AFFILIATE:A/AFFILIATE_MARKUP']).toBeUndefined(); // 0 qator yozilmaydi
    expect(one['PLATFORM_SERVICE/PLATFORM_MARKUP']).toBe(1);
  });

  it('TC7: har ustama uchun (0…10 000) qatorlar yig‘indisi sotuv narxiga teng va sotuvchi ulushi ⌊0.85U⌋', () => {
    for (let u = 0; u <= 10000; u++) {
      const lines = splitDelivered(orderEvent({}, { salePrice: 251000 + u }));
      const positive = lines.filter((l) => l.lineKind !== 'COD_RECEIVABLE');
      expect(positive.reduce((s, l) => s + l.amount, 0)).toBe(251000 + u);
      expect(lines.reduce((s, l) => s + l.amount, 0)).toBe(0);
      const aff =
        lines.find((l) => l.lineKind === 'AFFILIATE_MARKUP')?.amount ?? 0;
      expect(aff).toBe(Math.floor((u * 85) / 100));
    }
  });

  it('TC8: qisman rejim (262 000, yashirilgan 10 000) — ELCHI 10 000, ustama faqat tovar qismidan', () => {
    const partial = {
      approvedPrice: 262000,
      salePrice: 262000,
      split: {
        affiliateFee: 65000,
        callCenterFee: 12000,
        hiddenDelivery: 10000,
      },
    };
    expect(
      view(
        splitDelivered(
          orderEvent({ delivery: { mode: 'PARTIAL', cost: 30000 } }, partial),
        ),
      ),
    ).toMatchObject({
      'ELCHI/HIDDEN_DELIVERY': 10000,
      'PLATFORM_SERVICE/PLATFORM_SERVICE': 35000,
    });
    const marked = view(
      splitDelivered(
        orderEvent(
          { delivery: { mode: 'PARTIAL', cost: 30000 } },
          { ...partial, salePrice: 287000 },
        ),
      ),
    );
    expect(marked).toMatchObject({
      'ELCHI/HIDDEN_DELIVERY': 10000,
      'AFFILIATE:A/AFFILIATE_MARKUP': 21250,
      'PLATFORM_SERVICE/PLATFORM_MARKUP': 3750,
    });
  });

  it('ko‘p dona: narxlar soniga ko‘paytiriladi, split — qator jami', () => {
    const lines = view(
      splitDelivered(
        orderEvent(
          {},
          {
            quantity: 2,
            split: {
              affiliateFee: 130000,
              callCenterFee: 12000,
              hiddenDelivery: 0,
            },
          },
        ),
      ),
    );
    expect(lines['WHOLESALER:W/WHOLESALER_BASE']).toBe(280000);
    expect(lines['PLATFORM_SERVICE/PLATFORM_SERVICE']).toBe(
      502000 - 280000 - 130000 - 12000,
    );
  });

  it('noto‘g‘ri hodisa rad etiladi', () => {
    expect(() => splitDelivered(orderEvent({}, { salePrice: 250000 }))).toThrow(
      SplitError,
    );
    expect(() => splitDelivered(orderEvent({ affiliateId: null }))).toThrow(
      'affiliateId',
    );
    expect(() => splitDelivered(orderEvent({ wholesalerId: null }))).toThrow(
      'wholesalerId',
    );
    expect(() =>
      splitDelivered(orderEvent({}, { salePrice: 251000.5 })),
    ).toThrow('butun so‘m');
    expect(() =>
      splitDelivered(
        orderEvent(
          {},
          {
            split: {
              affiliateFee: 65000,
              callCenterFee: 12000,
              hiddenDelivery: 0,
              platformService: 30000,
            },
          },
        ),
      ),
    ).toThrow('platforma xizmati mos emas');
    expect(() =>
      splitDelivered(
        orderEvent(
          {},
          {
            split: {
              affiliateFee: 200000,
              callCenterFee: 12000,
              hiddenDelivery: 0,
            },
          },
        ),
      ),
    ).toThrow('qoldig‘i');
  });

  it('asosiy sayt (SITE, sotuvchisiz): sotuvchi haqi platformada qoladi', () => {
    const lines = view(
      splitDelivered(orderEvent({ source: 'SITE', affiliateId: null })),
    );
    expect(lines['PLATFORM_SERVICE/AFFILIATE_FEE']).toBe(65000);
    expect(Object.keys(lines).some((k) => k.startsWith('AFFILIATE'))).toBe(
      false,
    );
  });

  it('asosiy sayt sotuvida affiliateId bo‘lsa ham sotuvchi haqi platformaga', () => {
    const lines = view(
      splitDelivered(orderEvent({ source: 'SITE', affiliateId: 'A' })),
    );
    expect(lines['PLATFORM_SERVICE/AFFILIATE_FEE']).toBe(65000);
    expect(Object.keys(lines).some((k) => k.startsWith('AFFILIATE:'))).toBe(
      false,
    );
  });

  it('har tovar qatori o‘z optovigiga (items[].wholesalerId)', () => {
    const e = orderEvent();
    e.items.push({
      ...e.items[0],
      productId: '90',
      wholesalerId: 'W2',
      basePrice: 100000,
      approvedPrice: 211000,
      salePrice: 211000,
    });
    const lines = splitDelivered(e).filter((l) => l.account === 'WHOLESALER');
    expect(lines.map((l) => [l.ownerId, l.amount])).toEqual([
      ['W', 140000],
      ['W2', 100000],
    ]);
  });
});
