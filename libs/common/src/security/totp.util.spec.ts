import {
  base32Decode,
  base32Encode,
  generateTotpSecret,
  otpauthUrl,
  totpAt,
  verifyTotp,
} from './totp.util';

describe('BE-26: TOTP (RFC 6238)', () => {
  // RFC 6238 Appendix B: sir — ASCII "12345678901234567890", SHA1; 8 raqamli koddan oxirgi 6 tasi
  const secret = base32Encode(Buffer.from('12345678901234567890'));

  it.each([
    [59, '287082'],
    [1111111109, '081804'],
    [1111111111, '050471'],
    [1234567890, '005924'],
    [2000000000, '279037'],
  ])('RFC 6238 test vektori: T=%i → %s', (time, code) => {
    expect(totpAt(secret, Math.floor(time / 30))).toBe(code);
  });

  it('base32 ikki tomonga; sir 20 bayt', () => {
    const s = generateTotpSecret();
    expect(base32Decode(s)).toHaveLength(20);
    expect(base32Encode(base32Decode(s))).toBe(s);
  });

  it('tekshiruv: ±1 oraliq qabul qilinadi, uzoqrog‘i va noto‘g‘ri format — yo‘q', () => {
    const now = 1111111111 * 1000;
    expect(verifyTotp(secret, '050471', now)).toBe(Math.floor(1111111111 / 30));
    expect(
      verifyTotp(secret, totpAt(secret, Math.floor(1111111111 / 30) - 1), now),
    ).not.toBeNull();
    expect(
      verifyTotp(secret, totpAt(secret, Math.floor(1111111111 / 30) - 3), now),
    ).toBeNull();
    expect(verifyTotp(secret, '12345', now)).toBeNull();
  });

  it('otpauth havolasi', () => {
    expect(otpauthUrl('ABC', '+998901234567')).toBe(
      'otpauth://totp/Elchi%20Marketplace%3A%2B998901234567?secret=ABC&issuer=Elchi%20Marketplace&algorithm=SHA1&digits=6&period=30',
    );
  });
});
