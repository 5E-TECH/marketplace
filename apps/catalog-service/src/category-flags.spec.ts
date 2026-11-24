import { CategoryFlagRow, resolveCategoryFlags } from './category-flags';

const row = (
  id: string,
  parentId: string | null,
  isBad: boolean | null = null,
  expiryTracked: boolean | null = null,
): CategoryFlagRow => ({ id, parentId, isBad, expiryTracked });

/** BE-25 (FE-12, FE-16; TZ OMB-3, 8-bo‘lim): toifa belgilari ota toifadan meros. */
describe('resolveCategoryFlags', () => {
  it('belgisiz va toifasiz — «yo‘q»', () => {
    const flags = resolveCategoryFlags([row('1', null), row('2', '1')]);
    expect(flags('2')).toEqual({ isBad: false, expiryTracked: false });
    expect(flags(null)).toEqual({ isBad: false, expiryTracked: false });
    expect(flags('404')).toEqual({ isBad: false, expiryTracked: false });
  });

  it('null — eng yaqin otadan; har belgi alohida; o‘z qiymati ustun', () => {
    const flags = resolveCategoryFlags([
      row('1', null, null, true),
      row('2', '1'),
      row('3', '2', null, false),
      row('4', '3'),
    ]);
    expect(flags('2')).toEqual({ isBad: false, expiryTracked: true });
    expect(flags('3')).toEqual({ isBad: false, expiryTracked: false });
    expect(flags('4')).toEqual({ isBad: false, expiryTracked: false });
  });

  it('BAD toifasida muddat doim kuzatiladi (OMB-3), belgi o‘chirilgan bo‘lsa ham', () => {
    const flags = resolveCategoryFlags([
      row('1', null, true, false),
      row('2', '1'),
      row('3', '1', false),
    ]);
    expect(flags('1')).toEqual({ isBad: true, expiryTracked: true });
    expect(flags('2')).toEqual({ isBad: true, expiryTracked: true });
    expect(flags('3')).toEqual({ isBad: false, expiryTracked: false });
  });

  it('daraxtda sikl bo‘lsa ham to‘xtab qolmaydi', () => {
    const flags = resolveCategoryFlags([row('1', '2'), row('2', '1')]);
    expect(flags('1')).toEqual({ isBad: false, expiryTracked: false });
  });
});
