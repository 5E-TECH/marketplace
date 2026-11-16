import { LeadStatus } from '@app/common';
import {
  duplicateDecision,
  isHoneypotFilled,
  LEAD_RULES,
  phoneOperatorAllowed,
} from './lead-rules';

const now = new Date('2026-12-10T10:00:00.000Z');
const daysAgo = (d: number) => new Date(now.getTime() - d * 24 * 3600 * 1000);
const prev = (status: LeadStatus, rejectedAt: Date | null = null) => ({
  id: '7001',
  status,
  rejectedAt,
});

describe('Lid qoidalari (BE-12; TZ 5-bo‘lim)', () => {
  it('qiymatlar TZ va karta bilan bir xil', () => {
    expect(LEAD_RULES).toEqual({
      duplicateWindowDays: 30,
      rejectedReopenDays: 3,
      contactWindowDays: 3,
      ipWindowMinutes: 10,
      ipMaxLeads: 5,
      blacklistRejections: 2,
    });
  });

  it('avvalgi lid yo‘q → yangi lid', () => {
    expect(duplicateDecision(null, now)).toEqual({ kind: 'NEW' });
  });

  it.each([
    LeadStatus.NEW,
    LeadStatus.BOOKED,
    LeadStatus.CALLBACK,
    LeadStatus.CONFIRMED,
  ])('9-qoida: avvalgi lid %s → qo‘shiladi', (status) => {
    expect(duplicateDecision(prev(status), now)).toEqual({
      kind: 'MERGE',
      rootId: '7001',
    });
  });

  it('10-qoida: «Aloqa bo‘lmadi» → qayta ochiladi', () => {
    expect(duplicateDecision(prev(LeadStatus.NO_CONTACT), now)).toEqual({
      kind: 'REOPEN_AND_MERGE',
      rootId: '7001',
    });
  });

  it('«Rad etildi»: 3 kun ichida qo‘shiladi, 3 kundan keyin yangi lid (9, 10-qoidalar)', () => {
    expect(
      duplicateDecision(prev(LeadStatus.REJECTED, daysAgo(2)), now),
    ).toEqual({ kind: 'MERGE', rootId: '7001' });
    expect(
      duplicateDecision(prev(LeadStatus.REJECTED, daysAgo(3)), now),
    ).toEqual({ kind: 'NEW' });
  });

  it('yashirin maydon: bo‘sh satr — odam, boshqa qiymat — bot', () => {
    expect(isHoneypotFilled(undefined)).toBe(false);
    expect(isHoneypotFilled('')).toBe(false);
    expect(isHoneypotFilled('x')).toBe(true);
    expect(isHoneypotFilled(0)).toBe(true);
  });

  it('operator kodi: ro‘yxat berilmasa tekshirilmaydi, berilsa faqat ro‘yxatdagilar', () => {
    expect(phoneOperatorAllowed('+998121234567', [])).toBe(true);
    expect(phoneOperatorAllowed('+998901234567', ['90', '91'])).toBe(true);
    expect(phoneOperatorAllowed('+998121234567', ['90', '91'])).toBe(false);
  });
});
