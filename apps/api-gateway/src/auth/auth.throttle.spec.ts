import { AuthController } from './auth.controller';
import { SellersController } from '../sellers/sellers.controller';

/**
 * Brute-force himoyasi: nozik endpointlarda umumiy chegara emas, qattiq limit
 * turishi kerak. Limit tasodifan olib tashlansa shu test yiqiladi.
 */
describe('Rate limiting — nozik endpointlar', () => {
  // @nestjs/throttler metadata kalitlari: prefiks + throttler nomi
  // (paket root'idan eksport qilinmagan, shuning uchun shu yerda).
  const THROTTLER_LIMIT = 'THROTTLER:LIMITdefault';
  const THROTTLER_TTL = 'THROTTLER:TTLdefault';

  const limitOf = (target: object, method: string): number | undefined =>
    Reflect.getMetadata(
      THROTTLER_LIMIT,
      (target as Record<string, object>)[method],
    ) as number | undefined;

  const ttlOf = (target: object, method: string): number | undefined =>
    Reflect.getMetadata(
      THROTTLER_TTL,
      (target as Record<string, object>)[method],
    ) as number | undefined;

  const expected: Array<[string, number]> = [
    ['login', 5],
    ['register', 5],
    ['refresh', 30],
    ['forgot', 3],
    ['reset', 5],
    ['verify', 5],
    ['resend', 3],
  ];

  it.each(expected)('auth.%s → daqiqada %i so‘rov', (method, limit) => {
    expect(limitOf(AuthController.prototype, method)).toBe(limit);
    expect(ttlOf(AuthController.prototype, method)).toBe(60_000);
  });

  it('sellers.register ham cheklangan', () => {
    expect(limitOf(SellersController.prototype, 'register')).toBe(5);
    expect(ttlOf(SellersController.prototype, 'register')).toBe(60_000);
  });
});
