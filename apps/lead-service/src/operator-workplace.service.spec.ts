import { LeadOutcome, LeadRejectReason, LeadStatus } from '@app/common';
import { clampToCallWindow } from './lead-schedule';
import {
  nextAttemptOf,
  productView,
  rejectReasonOf,
} from './operator-workplace.service';

describe('BE-25 (FE-08): operator ish joyi — sof hisoblar', () => {
  const next = new Date('2026-12-02T04:00:00.000Z'); // 09:00 Toshkent

  it('keyingi qo‘ng‘iroq: oxirgi urinish va lid qayta qo‘ng‘iroqda — lidning haqiqiy (surilgan) vaqti', () => {
    expect(
      nextAttemptOf({
        latest: true,
        status: LeadStatus.CALLBACK,
        nextAttemptAt: next,
        callbackAt: new Date('2026-12-01T17:30:00.000Z'), // mijoz 22:30 degan
      }),
    ).toBe(next.toISOString());
  });

  it('eski urinish: mijoz aytgan vaqt qo‘ng‘iroq oynasiga surilgan holda; vaqtsiz — null', () => {
    const asked = new Date('2026-12-01T17:30:00.000Z');
    expect(
      nextAttemptOf({
        latest: false,
        status: LeadStatus.CALLBACK,
        nextAttemptAt: next,
        callbackAt: asked,
      }),
    ).toBe(clampToCallWindow(asked).toISOString());
    expect(
      nextAttemptOf({
        latest: false,
        status: LeadStatus.CALLBACK,
        nextAttemptAt: next,
        callbackAt: null,
      }),
    ).toBeNull();
    expect(
      nextAttemptOf({
        latest: true,
        status: LeadStatus.CONFIRMED,
        nextAttemptAt: null,
        callbackAt: null,
      }),
    ).toBeNull();
  });

  it('rad sababi faqat oxirgi REJECTED urinishida va lid hali rad etilgan bo‘lsa', () => {
    const base = {
      outcome: LeadOutcome.REJECTED,
      latest: true,
      status: LeadStatus.REJECTED,
      rejectReason: LeadRejectReason.NOT_NEEDED,
    };
    expect(rejectReasonOf(base)).toBe(LeadRejectReason.NOT_NEEDED);
    // admin qayta ochgan yoki keyin boshqa operator boshqa sabab bilan rad etgan
    expect(rejectReasonOf({ ...base, status: LeadStatus.NEW })).toBeNull();
    expect(rejectReasonOf({ ...base, latest: false })).toBeNull();
    expect(
      rejectReasonOf({ ...base, outcome: LeadOutcome.NO_ANSWER }),
    ).toBeNull();
  });

  it('mahsulot paneli: API/sayt lidida sahifa yo‘q; offer matnlari yo‘q bo‘lsa — bo‘sh', () => {
    const view = productView(
      { productId: '501', salePrice: '262000' },
      null,
      null,
      null,
      () => 'https://x',
    );
    expect(view).toMatchObject({
      name: '',
      highlights: [],
      contents: null,
      salePrice: 262000,
      deliveryFee: null,
      pageUrl: null,
      warning: null,
    });
  });
});
