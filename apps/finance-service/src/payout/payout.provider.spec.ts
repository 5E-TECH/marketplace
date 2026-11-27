import { ConfigService } from '@nestjs/config';
import { createServer, IncomingMessage, Server, ServerResponse } from 'http';
import { AddressInfo } from 'net';
import {
  PayoutNotSentError,
  PayoutProvider,
  PayoutRejectedError,
  PayoutUnknownError,
} from './payout.provider';

type Handler = (
  req: IncomingMessage & { body: string },
  res: ServerResponse,
) => void;

/** BE-32: provayder adapterining umumiy HTTP shakli — haqiqiy lokal HTTP server bilan. */
describe('PayoutProvider (umumiy HTTP shakl)', () => {
  let server: Server;
  let base: string;
  let handler: Handler;
  const seen: Array<{
    method?: string;
    url?: string;
    auth?: string;
    body: string;
  }> = [];
  const provider = (url = base) =>
    new PayoutProvider(
      new ConfigService({ PAYOUT_API_URL: url, PAYOUT_API_TOKEN: 'tkn' }),
    );
  const json = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        seen.push({
          method: req.method,
          url: req.url,
          auth: req.headers.authorization,
          body,
        });
        handler(Object.assign(req, { body }), res);
      });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/`;
  });
  afterAll(() => new Promise((resolve) => server.close(resolve)));
  beforeEach(() => (seen.length = 0));

  it('URL bo‘sh — o‘chiq', () => {
    expect(provider('').isConfigured()).toBe(false);
    expect(provider().isConfigured()).toBe(true);
  });

  it('karta sessiyasi: https sahifa qaytadi; http yoki bo‘sh — rad', async () => {
    handler = (_req, res) => json(res, 200, { url: 'https://pay.uz/bind/1' });
    await expect(
      provider().createCardSession({
        sessionRef: 's-1',
        returnUrl: null,
        pinfl: '12345678901234',
      }),
    ).resolves.toEqual({ url: 'https://pay.uz/bind/1' });
    expect(seen[0]).toMatchObject({
      method: 'POST',
      url: '/v1/card-sessions',
      auth: 'Bearer tkn',
    });
    expect(JSON.parse(seen[0].body)).toEqual({
      sessionRef: 's-1',
      returnUrl: null,
      pinfl: '12345678901234',
    });
    handler = (_req, res) => json(res, 200, { url: 'http://pay.uz/bind/1' });
    await expect(
      provider().createCardSession({
        sessionRef: 's',
        returnUrl: null,
        pinfl: null,
      }),
    ).rejects.toBeInstanceOf(PayoutRejectedError);
  });

  it('to‘lov: SUCCESS/PENDING/FAILED; 400/422 — aniq rad (sabab bilan); 5xx va holatsiz javob — noma’lum', async () => {
    const input = {
      payoutRef: 'wd-7',
      cardToken: 'tok_1',
      amount: 990000,
      purpose: 'x',
    };
    handler = (_req, res) => json(res, 200, { status: 'SUCCESS' });
    await expect(provider().send(input)).resolves.toEqual({
      status: 'SUCCESS',
      reason: null,
    });
    expect(JSON.parse(seen[0].body)).toEqual({ ...input, currency: 'UZS' });
    handler = (_req, res) =>
      json(res, 200, { status: 'FAILED', reason: 'Karta bloklangan' });
    await expect(provider().send(input)).resolves.toEqual({
      status: 'FAILED',
      reason: 'Karta bloklangan',
    });
    handler = (_req, res) => json(res, 422, { reason: 'token eskirgan' });
    const rejected = await provider()
      .send(input)
      .catch((e: unknown) => e);
    expect(rejected).toBeInstanceOf(PayoutRejectedError);
    expect((rejected as PayoutRejectedError).message).toBe(
      'provayder HTTP 422: token eskirgan',
    );
    expect((rejected as PayoutRejectedError).reason).toBe('token eskirgan');
    // avtorizatsiya va chegara — bajarilmagan; 409 («shu ref bilan bor») — noma’lum
    handler = (_req, res) => json(res, 401, {});
    await expect(provider().send(input)).rejects.toBeInstanceOf(
      PayoutNotSentError,
    );
    handler = (_req, res) => json(res, 429, {});
    await expect(provider().send(input)).rejects.toBeInstanceOf(
      PayoutNotSentError,
    );
    handler = (_req, res) => json(res, 409, { reason: 'duplicate' });
    await expect(provider().send(input)).rejects.toBeInstanceOf(
      PayoutUnknownError,
    );
    handler = (_req, res) => json(res, 502, {});
    await expect(provider().send(input)).rejects.toBeInstanceOf(
      PayoutUnknownError,
    );
    handler = (_req, res) => json(res, 200, { ok: true });
    await expect(provider().send(input)).rejects.toBeInstanceOf(
      PayoutUnknownError,
    );
  });

  it('holat: 404 — null; ulanib bo‘lmasa — noma’lum (qayta yuborilmaydi)', async () => {
    // yopiq port: server ochib yopamiz
    const closed = createServer();
    await new Promise<void>((resolve) =>
      closed.listen(0, '127.0.0.1', resolve),
    );
    const port = (closed.address() as AddressInfo).port;
    await new Promise((resolve) => closed.close(resolve));
    const dead = `http://127.0.0.1:${port}`;
    handler = (_req, res) => json(res, 200, { status: 'PENDING' });
    await expect(provider().status('wd-7')).resolves.toEqual({
      status: 'PENDING',
      reason: null,
    });
    expect(seen[0]).toMatchObject({ method: 'GET', url: '/v1/payouts/wd-7' });
    handler = (_req, res) => json(res, 404, { reason: 'not found' });
    await expect(provider().status('wd-7')).resolves.toBeNull();
    await expect(provider(dead).status('wd-7')).rejects.toBeInstanceOf(
      PayoutUnknownError,
    );
    // yuborishda ulanib bo‘lmadi — so‘rov provayderga yetmagan: qayta yuborish xavfsiz
    await expect(
      provider(dead).send({
        payoutRef: 'wd-7',
        cardToken: 't',
        amount: 1,
        purpose: 'x',
      }),
    ).rejects.toBeInstanceOf(PayoutNotSentError);
  });
});
