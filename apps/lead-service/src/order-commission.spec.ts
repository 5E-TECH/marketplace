import {
  AffiliateCommissionState,
  LeadOrderStatus,
  LeadStatus,
} from '@app/common';
import { orderEvent } from '../../finance-service/src/ledger/order-events.samples';
import { splitDelivered } from '../../finance-service/src/ledger/split';
import { commissionOf } from './lead-stats.service';
import { expectedAffiliateCommission } from './order-commission';

describe('«Kutilmoqda» haqi (BE-28, hujjat-statistika-csv H)', () => {
  it('L-1197: 65 000 haq + 25 000 ustamaning 85% i = 86 250', () => {
    expect(
      expectedAffiliateCommission(
        orderEvent({}, { approvedPrice: 251000, salePrice: 276000 }).items,
      ),
    ).toBe(86250);
  });

  it('finance taqsimoti (BE-22 split.ts) bilan bir xil: ustama 0…3 000, 1 va 2 dona', () => {
    for (const quantity of [1, 2])
      for (let u = 0; u <= 3000; u += 7) {
        const event = orderEvent(
          {},
          {
            quantity,
            salePrice: 251000 + u,
            split: {
              affiliateFee: 65000 * quantity,
              callCenterFee: 12000,
              hiddenDelivery: 0,
            },
          },
        );
        const ledger = splitDelivered(event)
          .filter((l) => l.account === 'AFFILIATE')
          .reduce((s, l) => s + l.amount, 0);
        expect(expectedAffiliateCommission(event.items)).toBe(ledger);
      }
  });

  it('noto‘g‘ri narx nusxasi — bo‘sh (taxmin qilinmaydi)', () => {
    const items = (over: object) => orderEvent({}, over).items;
    expect(expectedAffiliateCommission(undefined)).toBeNull();
    expect(expectedAffiliateCommission([])).toBeNull();
    expect(
      expectedAffiliateCommission(items({ salePrice: 250000 })),
    ).toBeNull();
    expect(expectedAffiliateCommission(items({ quantity: 0 }))).toBeNull();
    expect(
      expectedAffiliateCommission(items({ salePrice: 251000.5 })),
    ).toBeNull();
    expect(
      expectedAffiliateCommission(items({ split: undefined as never })),
    ).toBeNull();
  });
});

describe('haq holati (hujjat-statistika-csv I)', () => {
  const S = AffiliateCommissionState;
  it('ledger yozuvi bo‘lsa — u asosiy', () => {
    expect(
      commissionOf(LeadStatus.CONFIRMED, LeadOrderStatus.SETTLED, '1', {
        amount: 65000,
        state: 'AVAILABLE',
      }),
    ).toEqual({ commission: 65000, commissionState: S.AVAILABLE });
  });
  it('ishlanayotgan lid — bo‘sh; rad, yaroqsiz, dublikat, aloqa bo‘lmadi — «Yozilmaydi»', () => {
    for (const st of [LeadStatus.NEW, LeadStatus.BOOKED, LeadStatus.CALLBACK])
      expect(commissionOf(st, null, null, undefined)).toEqual({
        commission: null,
        commissionState: null,
      });
    for (const st of [
      LeadStatus.REJECTED,
      LeadStatus.INVALID,
      LeadStatus.MERGED,
      LeadStatus.NO_CONTACT,
    ])
      expect(commissionOf(st, null, null, undefined)).toEqual({
        commission: null,
        commissionState: S.NONE,
      });
  });
  it('yetkazilgan, ledger qatori yo‘q: haq 0 yoki noma’lum — Yozilmaydi; musbat — Kutilmoqda (ledger hali yozmagan)', () => {
    for (const o of [LeadOrderStatus.DELIVERED, LeadOrderStatus.SETTLED]) {
      expect(commissionOf(LeadStatus.CONFIRMED, o, '0', undefined)).toEqual({
        commission: null,
        commissionState: S.NONE,
      });
      expect(commissionOf(LeadStatus.CONFIRMED, o, null, undefined)).toEqual({
        commission: null,
        commissionState: S.NONE,
      });
    }
    expect(
      commissionOf(
        LeadStatus.CONFIRMED,
        LeadOrderStatus.DELIVERED,
        '65000',
        undefined,
      ),
    ).toEqual({ commission: 65000, commissionState: S.PENDING });
  });

  it('tasdiqlangan: yo‘lda — Kutilmoqda (narx nusxasidan); rad yoki bekor — Yozilmaydi', () => {
    expect(
      commissionOf(
        LeadStatus.CONFIRMED,
        LeadOrderStatus.IN_TRANSIT,
        '86250',
        undefined,
      ),
    ).toEqual({ commission: 86250, commissionState: S.PENDING });
    expect(commissionOf(LeadStatus.CONFIRMED, null, null, undefined)).toEqual({
      commission: null,
      commissionState: S.PENDING,
    });
    for (const o of [
      LeadOrderStatus.REFUSED,
      LeadOrderStatus.RETURNING,
      LeadOrderStatus.RETURNED_GRADED,
      LeadOrderStatus.CANCELLED,
    ])
      expect(commissionOf(LeadStatus.CONFIRMED, o, '65000', undefined)).toEqual(
        { commission: null, commissionState: S.NONE },
      );
  });
});
