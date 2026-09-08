import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { of } from 'rxjs';
import { request } from 'http';
import { JwtAuthGuard, RolesGuard, Role, RmqClient } from '@app/common';
import { PaymentsController } from './payments.controller';

// Opt in where local listening sockets are allowed; no external provider used.
const httpTests =
  process.env.PAYMENT_HTTP_TEST === '1' ? describe : describe.skip;
httpTests('Payment HTTP contract', () => {
  let app: INestApplication;
  let port: number;
  const jwt = new JwtService({ secret: 'isolated-http-test-secret' });
  const payment = { send: jest.fn() };
  const checkout = { send: jest.fn() };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [PaymentsController],
      providers: [
        { provide: RmqClient.PAYMENT, useValue: payment },
        { provide: RmqClient.CHECKOUT, useValue: checkout },
      ],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalGuards(
      new JwtAuthGuard(jwt, new Reflector()),
      new RolesGuard(new Reflector()),
    );
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true }),
    );
    await app.listen(0, '127.0.0.1');
    port = app.getHttpServer().address().port;
  });
  afterAll(async () => {
    await app?.close();
  });
  beforeEach(() => {
    payment.send.mockReset();
    checkout.send.mockReset();
  });
  const token = (role: Role) => `Bearer ${jwt.sign({ sub: '7', role })}`;
  const call = (
    path: string,
    body?: object | string,
    authorization?: string,
    method = 'POST',
  ): Promise<{ status: number; body: any }> =>
    new Promise((resolve, reject) => {
      const raw = typeof body === 'string' ? body : JSON.stringify(body ?? {});
      const req = request(
        {
          host: '127.0.0.1',
          port,
          path: `/api/v1/${path}`,
          method,
          headers: {
            'content-type':
              typeof body === 'string'
                ? 'application/x-www-form-urlencoded'
                : 'application/json',
            ...(authorization ? { authorization } : {}),
          },
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () =>
            resolve({
              status: res.statusCode!,
              body: data ? JSON.parse(data) : null,
            }),
          );
        },
      );
      req.on('error', reject);
      req.end(method === 'GET' ? undefined : raw);
    });

  it('Payme Basic auth reaches provider handler and JSON-RPC stays unwrapped HTTP 200', async () => {
    const response = { jsonrpc: '2.0', id: 1, error: { code: -32504 } };
    payment.send.mockReturnValue(of(response));
    const body = { id: 1, method: 'CheckPerformTransaction', params: {} };
    expect(
      await call('payments/payme/callback', body, 'Basic dGVzdA=='),
    ).toEqual({ status: 200, body: response });
    expect(payment.send).toHaveBeenCalledWith(
      { cmd: 'payment.payme.callback' },
      { authorization: 'Basic dGVzdA==', body },
    );
  });
  it('Click form-urlencoded retains exact amount string used by signature', async () => {
    payment.send.mockReturnValue(of({ error: 0 }));
    expect(
      (
        await call(
          'payments/click/prepare',
          'amount=125000.00&action=0&sign_string=abc',
        )
      ).status,
    ).toBe(200);
    expect(payment.send).toHaveBeenCalledWith(
      { cmd: 'payment.click.prepare' },
      { body: { amount: '125000.00', action: '0', sign_string: 'abc' } },
    );
  });
  it.each([Role.ADMIN, Role.BUYER, Role.SELLER])(
    'provider configuration rejects %s',
    async (role) => {
      expect(
        (
          await call(
            'admin/payments/providers/CLICK',
            { serviceId: '123' },
            token(role),
            'PUT',
          )
        ).status,
      ).toBe(403);
      expect(payment.send).not.toHaveBeenCalled();
    },
  );
  it('provider status requires token and allows SUPERADMIN', async () => {
    expect(
      (
        await call(
          'admin/payments/providers/CLICK',
          undefined,
          undefined,
          'GET',
        )
      ).status,
    ).toBe(401);
    payment.send.mockReturnValue(of({ provider: 'CLICK', hasSecret: true }));
    expect(
      (
        await call(
          'admin/payments/providers/CLICK',
          undefined,
          token(Role.SUPERADMIN),
          'GET',
        )
      ).status,
    ).toBe(200);
  });
  it('invalid service ID gives 400 without forwarding secrets', async () => {
    expect(
      (
        await call(
          'admin/payments/providers/CLICK',
          { serviceId: 'abc', secret: 'test' },
          token(Role.SUPERADMIN),
          'PUT',
        )
      ).status,
    ).toBe(400);
    expect(payment.send).not.toHaveBeenCalled();
  });
  it('payment amount is verified against owned checkout order', async () => {
    checkout.send.mockReturnValue(of({ amount: 500 }));
    expect(
      (
        await call(
          'payments',
          { salesOrderId: '42', provider: 'PAYME', amount: 1 },
          token(Role.BUYER),
        )
      ).status,
    ).toBe(400);
    expect(checkout.send).toHaveBeenCalledWith(
      { cmd: 'checkout.payment-context' },
      { orderId: '42', customerId: '7' },
    );
    expect(payment.send).not.toHaveBeenCalled();
    payment.send.mockReturnValue(of({ id: '1' }));
    expect(
      (
        await call(
          'payments',
          { salesOrderId: '42', provider: 'PAYME', amount: 500 },
          token(Role.BUYER),
        )
      ).status,
    ).toBe(201);
  });
});
