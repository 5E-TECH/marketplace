import { tashkentTime } from './pdf-text';

describe('pdf-text (BE-17)', () => {
  it('vaqt Toshkentda (UTC+5)', () => {
    expect(tashkentTime('2026-11-21T22:30:00.000Z')).toBe('2026-11-22 03:30');
  });
});
