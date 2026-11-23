import {
  ElchiCheckParcel,
  ElchiCheckReason as R,
  ElchiShipmentStatus,
  LeadOrderStatus as S,
} from '@app/common';
import {
  compareElchiShipment,
  ELCHI_STATUS_MATCH,
  RecordedRemittance,
} from './elchi-check.compare';

const parcel = (status: S, codAmount = 292_000): ElchiCheckParcel => ({
  orderId: '1042',
  orderNumber: 'L-1042',
  shipmentId: '880113',
  status,
  codAmount,
});

const elchi = (
  status: string,
  money: Partial<ElchiShipmentStatus> = {},
): ElchiShipmentStatus => ({
  shipmentId: '880113',
  externalOrderId: 'mp-order:1042',
  status,
  collectedFromCustomer: null,
  elchiFee: 25_000,
  marketPaidAmount: 0,
  codAmount: 292_000,
  extraCost: 0,
  ...money,
});

const PAID = {
  collectedFromCustomer: 292_000,
  elchiFee: 25_000,
  marketPaidAmount: 267_000,
};
const recorded = (
  over: Partial<RecordedRemittance> = {},
): RecordedRemittance => ({ ...PAID, ...over });

describe('BE-46 TC3: Elchi tekshiruvi — posilka solishtiruvi', () => {
  it.each([
    ['on the road', S.HANDED_TO_ELCHI],
    ['waiting_customer', S.IN_TRANSIT],
    ['received', S.IN_TRANSIT],
    ['cancelled', S.REFUSED],
    ['returned_to_market', S.RETURNING],
    ['cancelled (sent)', S.RETURNED_GRADED],
    ['closed', S.CANCELLED],
    ['returned_to_market', S.CANCELLED],
  ])('holat mos: Elchi %p, bizda %p — farq yo‘q', (status, ours) => {
    expect(compareElchiShipment(parcel(ours), elchi(status), null)).toEqual({
      reasons: [],
      elchiCollected: null,
      elchiFee: 25_000,
      elchiMarketPaid: 0,
      elchiExtraCost: 0,
    });
  });

  it.each([
    ['sold', S.RETURNING],
    ['sold', S.RETURNED_GRADED],
    ['partly_paid', S.RETURNING],
  ])(
    'qaytarish (BE-44) Elchi’ga bormaydi: Elchi %p, bizda %p — mos',
    (status, ours) => {
      expect(
        compareElchiShipment(
          parcel(ours),
          elchi(status, { ...PAID, marketPaidAmount: 0 }),
          status === 'partly_paid' ? recorded({ marketPaidAmount: 0 }) : null,
        ).reasons,
      ).toEqual([]);
    },
  );

  it('«bozorga qaytarildi» xabari yo‘qolgan: Elchi returned_to_market, bizda hali rad etildi → STATUS', () => {
    expect(
      compareElchiShipment(parcel(S.REFUSED), elchi('returned_to_market'), null)
        .reasons,
    ).toEqual([R.STATUS]);
  });

  it('kuryer qo‘shimcha xarajati: sotilgan posilkada extra_cost > 0 → EXTRA_COST (o‘tkazmadan ushlanadi)', () => {
    expect(
      compareElchiShipment(
        parcel(S.REMITTED),
        elchi('paid', { ...PAID, extraCost: 15_000 }),
        recorded(),
      ),
    ).toMatchObject({ reasons: [R.EXTRA_COST], elchiExtraCost: 15_000 });
  });

  it.each([
    [20_000, 20_000, []],
    [0, null, []],
    [20_000, null, [R.REFUSAL_FEE]],
    [25_000, 20_000, [R.REFUSAL_FEE]],
    [0, 20_000, [R.REFUSAL_FEE]],
  ])(
    'rad to‘lovi: Elchi xarajati %p, moliyada %p → %p',
    (extraCost, recordedFee, reasons) => {
      expect(
        compareElchiShipment(
          parcel(S.REFUSED),
          elchi('cancelled', { extraCost }),
          null,
          recordedFee,
        ).reasons,
      ).toEqual(reasons);
    },
  );

  it('mos: Elchi «to‘landi», bizda REMITTED, o‘tkazma yozuvi bir xil', () => {
    expect(
      compareElchiShipment(parcel(S.REMITTED), elchi('paid', PAID), recorded())
        .reasons,
    ).toEqual([]);
  });

  it('mos: Elchi «sotildi», bizda yetkazildi, yig‘ilgani = COD (o‘tkazma hali yo‘q)', () => {
    expect(
      compareElchiShipment(
        parcel(S.DELIVERED),
        elchi('sold', { collectedFromCustomer: 292_000 }),
        null,
      ).reasons,
    ).toEqual([]);
  });

  it('webhook kelmagan: Elchi «to‘landi», bizda yetkazildi va o‘tkazma yo‘q → STATUS + NO_REMITTANCE', () => {
    expect(
      compareElchiShipment(parcel(S.DELIVERED), elchi('paid', PAID), null)
        .reasons,
    ).toEqual([R.NO_REMITTANCE, R.STATUS]);
  });

  it('Elchi orqaga qaytardi: bizda REMITTED, Elchi hali yo‘lda → STATUS', () => {
    expect(
      compareElchiShipment(parcel(S.REMITTED), elchi('on the road'), recorded())
        .reasons,
    ).toEqual([R.STATUS]);
  });

  it('sotuv bekor: bizda yetkazildi, Elchi «bekor» → STATUS', () => {
    expect(
      compareElchiShipment(parcel(S.DELIVERED), elchi('cancelled'), null)
        .reasons,
    ).toEqual([R.STATUS]);
  });

  it('pul: mijozdan COD dan kam yig‘ilgan → COLLECTED', () => {
    expect(
      compareElchiShipment(
        parcel(S.DELIVERED),
        elchi('sold', { collectedFromCustomer: 242_000 }),
        null,
      ),
    ).toMatchObject({ reasons: [R.COLLECTED], elchiCollected: 242_000 });
  });

  it('pul: yozilgan o‘tkazmadan Elchi haqi va o‘tkazilgan summa farq qiladi → FEE + MARKET_PAID', () => {
    expect(
      compareElchiShipment(
        parcel(S.REMITTED),
        elchi('paid', { ...PAID, elchiFee: 30_000, marketPaidAmount: 262_000 }),
        recorded(),
      ).reasons,
    ).toEqual([R.FEE, R.MARKET_PAID]);
  });

  it('qisman to‘langan: keyin to‘liq to‘landi, «to‘landi» xabari kelmagan → STATUS + MARKET_PAID', () => {
    expect(
      compareElchiShipment(
        parcel(S.DELIVERED),
        elchi('paid', PAID),
        recorded({ marketPaidAmount: 100_000 }),
      ).reasons,
    ).toEqual([R.MARKET_PAID, R.STATUS]);
  });

  it('qisman to‘langan va yozilgani bir xil — mos (bizda yetkazildi)', () => {
    const partial = { ...PAID, marketPaidAmount: 100_000 };
    expect(
      compareElchiShipment(
        parcel(S.DELIVERED),
        elchi('partly_paid', partial),
        recorded(partial),
      ).reasons,
    ).toEqual([]);
  });

  it('qaytarish so‘rovi ochiq buyurtma: Elchi «to‘landi» — holat mos (BE-44), yozuv tekshiriladi', () => {
    expect(
      compareElchiShipment(
        parcel(S.RETURN_REQUESTED),
        elchi('paid', PAID),
        recorded(),
      ).reasons,
    ).toEqual([]);
  });

  it('noma’lum Elchi holati → UNKNOWN_STATUS', () => {
    expect(
      compareElchiShipment(parcel(S.IN_TRANSIT), elchi('teleported'), null)
        .reasons,
    ).toEqual([R.UNKNOWN_STATUS]);
  });

  it('Elchi posilkasi boshqa buyurtmaga bog‘langan → ORDER_REF', () => {
    expect(
      compareElchiShipment(
        parcel(S.IN_TRANSIT),
        elchi('on the road', { externalOrderId: 'mp-order:9999' }),
        null,
      ).reasons,
    ).toEqual([R.ORDER_REF]);
  });

  it('Elchi holatlari ro‘yxati Elchi-Backend `Order_status` ning hammasini qamraydi', () => {
    expect(Object.keys(ELCHI_STATUS_MATCH).sort()).toEqual(
      [
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
      ].sort(),
    );
  });
});
