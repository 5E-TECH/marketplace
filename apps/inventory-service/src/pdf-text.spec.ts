import { pdfText, tashkentTime } from './pdf-text';

describe('pdf-text (BE-17)', () => {
  it('o‘zbekcha ʻ va ʼ — WinAnsi dagi ‘ va ’ (Helvetica «»» chiqarmasin)', () => {
    expect(pdfText('Oʻzbekiston, gʻalla, maʼlumot')).toBe(
      'O‘zbekiston, g‘alla, ma’lumot',
    );
  });

  it('vaqt Toshkentda (UTC+5)', () => {
    expect(tashkentTime('2026-11-21T22:30:00.000Z')).toBe('2026-11-22 03:30');
  });
});
