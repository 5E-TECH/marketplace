import { PICK_CUTOFF_HOUR, pickDateFor, tashkentDate } from './fulfillment.dto';

/** Toshkent UTC+5 (yozgi vaqt yo‘q): 13:55 Toshkent = 08:55 UTC. */
describe('yig‘ish kuni (BE-19, OMB-4: 14:00 chegarasi)', () => {
  it('TC1: 13:55 da tasdiqlangan — o‘sha kun; 14:00 va undan keyin — ertasi kun', () => {
    expect(PICK_CUTOFF_HOUR).toBe(14);
    expect(pickDateFor(new Date('2026-12-15T08:55:00Z'))).toBe('2026-12-15');
    expect(pickDateFor(new Date('2026-12-15T08:59:59Z'))).toBe('2026-12-15');
    expect(pickDateFor(new Date('2026-12-15T09:00:00Z'))).toBe('2026-12-16');
    expect(pickDateFor(new Date('2026-12-15T13:30:00Z'))).toBe('2026-12-16');
  });

  it('Toshkent kuni UTC dan farq qiladi; oy va yil oxiri', () => {
    // 2026-12-14 20:30 UTC = 15-dekabr 01:30 Toshkent
    expect(tashkentDate(new Date('2026-12-14T20:30:00Z'))).toBe('2026-12-15');
    expect(pickDateFor(new Date('2026-12-14T20:30:00Z'))).toBe('2026-12-15');
    expect(pickDateFor(new Date('2026-12-31T10:00:00Z'))).toBe('2027-01-01');
    expect(pickDateFor(new Date('2026-11-30T12:00:00Z'))).toBe('2026-12-01');
  });
});
