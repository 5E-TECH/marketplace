import {
  assertSafeUrl,
  assertSafeUrlResolved,
  isPrivateAddress,
  isSafeUrl,
} from './ssrf.util';

describe('SSRF himoyasi (BE-14)', () => {
  it('TC3: 127.0.0.1, 10.0.0.5, [::1] va boshqa ichki manzillar rad', () => {
    for (const url of [
      'http://127.0.0.1/pb',
      'http://10.0.0.5/pb',
      'http://[::1]/pb',
      'http://[::ffff:10.0.0.5]/pb',
      'http://100.64.0.1/pb',
      'http://172.20.1.1/pb',
      'http://192.168.1.1/pb',
      'http://169.254.169.254/latest',
      'http://[fd00::1]/pb',
      'http://localhost:3000/pb',
      'ftp://tracker.example.com/pb',
    ])
      expect(isSafeUrl(url)).toBe(false);
    expect(isSafeUrl('https://tracker.example.com/pb?status={status}')).toBe(
      true,
    );
    expect(isSafeUrl('https://8.8.8.8/pb')).toBe(true);
  });

  it('isPrivateAddress: IPv4, IPv6 va IPv4-mapped', () => {
    expect(isPrivateAddress('10.1.2.3')).toBe(true);
    expect(isPrivateAddress('::ffff:192.168.0.1')).toBe(true);
    expect(isPrivateAddress('fe80::1')).toBe(true);
    expect(isPrivateAddress('93.184.216.34')).toBe(false);
    expect(isPrivateAddress('2606:4700::1111')).toBe(false);
  });

  it('TC4: tashqi domen ichki IP ga ochilsa rad; ochilmasa — «Domen topilmadi»', async () => {
    await expect(
      assertSafeUrlResolved('https://evil.example.com/pb', async () => [
        { address: '93.184.216.34' },
        { address: '10.0.0.5' },
      ]),
    ).rejects.toThrow(/SSRF/);
    await expect(
      assertSafeUrlResolved('https://tracker.example.com/pb', async () => [
        { address: '93.184.216.34' },
      ]),
    ).resolves.toBeInstanceOf(URL);
    await expect(
      assertSafeUrlResolved('https://yoq.example.com/pb', async () => {
        throw new Error('ENOTFOUND');
      }),
    ).rejects.toThrow('Domen topilmadi');
  });

  it('eski xatti-harakat saqlanadi: assertSafeUrl URL qaytaradi', () => {
    expect(assertSafeUrl('https://api.example.uz/x').hostname).toBe(
      'api.example.uz',
    );
  });
});
