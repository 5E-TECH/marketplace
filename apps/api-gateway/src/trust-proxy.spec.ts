import express from 'express';
import type { Request } from 'express';
import { configureTrustProxy } from './trust-proxy';

/**
 * Express'ning o'z `req.ip` / `req.protocol` getterlari ustida — ya'ni
 * rate limit (`ThrottlerGuard`) va audit jurnali (`@Ip()`) ko'radigan qiymat.
 * Manzillar prod o'lchovidan (docs/C4.8-TRUST-PROXY.md).
 */
describe('configureTrustProxy (C4.8: haqiqiy mijoz IP)', () => {
  const CLIENT = '62.164.155.87';
  const SPOOFED = '203.0.113.9';
  const CADDY = '172.20.0.5';
  const CLOUDFLARED = '172.20.0.6';
  const STOREFRONT = '172.20.0.9';

  const app = express();
  configureTrustProxy(app);

  function request(
    socketAddress: string,
    headers: Record<string, string> = {},
  ): Request {
    const req = Object.create(app.request) as Request & {
      app: typeof app;
      connection: unknown;
    };
    const socket = { remoteAddress: socketAddress, encrypted: false };
    Object.assign(req, { app, headers, socket, connection: socket });
    return req;
  }

  it('api.<domen>: cloudflared → caddy zanjiridan mijoz IP olinadi', () => {
    const req = request(CADDY, {
      'x-forwarded-for': `${CLIENT}, ${CLOUDFLARED}`,
    });
    expect(req.ip).toBe(CLIENT);
  });

  it('storefront proksisi kelgan X-Forwarded-For ni o‘zgartirmay uzatsa — mijoz IP', () => {
    const req = request(STOREFRONT, { 'x-forwarded-for': CLIENT });
    expect(req.ip).toBe(CLIENT);
  });

  it.each([
    [
      'api.<domen> (caddy orqali)',
      CADDY,
      `${SPOOFED}, ${CLIENT}, ${CLOUDFLARED}`,
    ],
    ['storefront proksisi orqali', STOREFRONT, `${SPOOFED}, ${CLIENT}`],
  ])(
    '%s: mijoz yozib yuborgan soxta X-Forwarded-For jurnalga tushmaydi',
    (_route, socket, forwardedFor) => {
      // Cloudflare/Caddy haqiqiy IP'ni ro'yxat oxiriga QO'SHADI — soxta
      // qiymat undan chapda qoladi va unga navbat yetmaydi.
      const req = request(socket, { 'x-forwarded-for': forwardedFor });
      expect(req.ip).toBe(CLIENT);
    },
  );

  it('ichki tarmoqdagi soxta manzil ham mijoz IP’sidan o‘ta olmaydi', () => {
    const req = request(STOREFRONT, {
      'x-forwarded-for': `10.0.0.1, ${CLIENT}`,
    });
    expect(req.ip).toBe(CLIENT);
  });

  it('tunnelsiz: caddy → api-gateway (bitta bosqich) ham shu sozlama bilan ishlaydi', () => {
    const req = request(CADDY, { 'x-forwarded-for': CLIENT });
    expect(req.ip).toBe(CLIENT);
  });

  it('IPv6 mijoz va IPv4-mapped soket manzili', () => {
    const req = request(`::ffff:${CADDY}`, {
      'x-forwarded-for': `2a02:4780:1::5, ${CLOUDFLARED}`,
    });
    expect(req.ip).toBe('2a02:4780:1::5');
  });

  it('ommaviy manzildan to‘g‘ridan-to‘g‘ri ulanishda X-Forwarded-For e’tiborsiz', () => {
    const req = request(CLIENT, { 'x-forwarded-for': SPOOFED });
    expect(req.ip).toBe(CLIENT);
  });

  it('storefront IP uzatmasa — proksining o‘z manzili (taxmin qilinmaydi)', () => {
    expect(request(STOREFRONT).ip).toBe(STOREFRONT);
  });

  it('X-Forwarded-Proto faqat ichki proksidan qabul qilinadi (Secure cookie)', () => {
    const headers = { 'x-forwarded-proto': 'https' };
    expect(request(STOREFRONT, headers).protocol).toBe('https');
    expect(request(CLIENT, headers).protocol).toBe('http');
  });
});
