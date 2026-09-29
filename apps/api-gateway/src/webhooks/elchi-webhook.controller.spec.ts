import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { of } from 'rxjs';
import { signHmacSha256 } from '@app/common';
import { ElchiWebhookController } from './elchi-webhook.controller';

describe('ElchiWebhookController (C2.4 / C1.40)', () => {
  const secret = 'test-webhook-secret-123456';
  const body = () => ({
    eventId: 'evt_123',
    type: 'shipment.status_changed',
    shipmentId: '77012',
    externalOrderId: '55',
    status: 'sold' as const,
    codCollected: 499000,
    occurredAt: new Date().toISOString(),
  });

  /**
   * Elchi'ning HAQIQIY tanasi — snake_case, o'z status lug'ati va ortiqcha
   * moliyaviy maydonlari bilan. Manba: Elchi-Backend integration-service
   * `enqueuePartnerWebhook`.
   */
  const elchiBody = (overrides: Record<string, unknown> = {}) => ({
    event: 'shipment.status_changed',
    event_id: '0f1d3c5e-7a9b-4c2d-8e6f-1a2b3c4d5e6f',
    external_order_id: '55',
    shipment_id: '77012',
    status: 'on the road',
    cod_collected: 0,
    market_paid_amount: 0,
    collected_from_customer: null,
    elchi_fee: null,
    market_amount: null,
    total_price: 450000,
    occurred_at: new Date().toISOString(),
    ...overrides,
  });

  function setup() {
    const checkout = { send: jest.fn(() => of({ received: true })) };
    const config = { get: jest.fn(() => secret) };
    return {
      controller: new ElchiWebhookController(
        checkout as never,
        config as never,
      ),
      checkout,
    };
  }

  /** Imzo XOM tana ustidan hisoblanadi — aynan shu tartibda uzatiladi. */
  function req(payload: unknown) {
    const rawBody = JSON.stringify(payload);
    return {
      request: { rawBody: Buffer.from(rawBody), body: payload } as never,
      signature: signHmacSha256(rawBody, secret),
    };
  }

  it('to‘g‘ri HMAC bilan webhookni checkoutga uzatadi', async () => {
    const { controller, checkout } = setup();
    const payload = body();
    const { request, signature } = req(payload);

    await expect(controller.receive(request, signature)).resolves.toMatchObject(
      { received: true },
    );
    expect(checkout.send).toHaveBeenCalledWith(
      { cmd: 'checkout.elchi-webhook.process' },
      payload,
    );
  });

  it('noto‘g‘ri HMACni 401 bilan rad etadi', async () => {
    const { controller, checkout } = setup();
    const { request } = req(body());

    await expect(controller.receive(request, 'invalid')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(checkout.send).not.toHaveBeenCalled();
  });

  it('Elchi’ning XOM tanasini qabul qiladi va normallashtirib uzatadi (C1.40 TC4)', async () => {
    const { controller, checkout } = setup();
    const { request, signature } = req(elchiBody());

    await expect(controller.receive(request, signature)).resolves.toMatchObject(
      { received: true },
    );
    const [, sent] = checkout.send.mock.calls[0] as unknown as [
      unknown,
      Record<string, unknown>,
    ];
    expect(sent).toMatchObject({
      eventId: '0f1d3c5e-7a9b-4c2d-8e6f-1a2b3c4d5e6f',
      type: 'shipment.status_changed',
      shipmentId: '77012',
      externalOrderId: '55',
      status: 'on_the_road',
    });
    // Ortiqcha maydonlar checkout'ga umuman yetib bormaydi.
    expect(sent).not.toHaveProperty('total_price');
    expect(sent).not.toHaveProperty('market_amount');
  });

  it('`closed` statusi 200 bilan e’tiborsiz qoldiriladi — checkout chaqirilmaydi', async () => {
    const { controller, checkout } = setup();
    const { request, signature } = req(elchiBody({ status: 'closed' }));

    await expect(controller.receive(request, signature)).resolves.toMatchObject(
      { received: true, ignored: 'closed' },
    );
    expect(checkout.send).not.toHaveBeenCalled();
  });

  it('outbox qayta urinishi (25 daqiqa kechikkan) QABUL qilinadi', async () => {
    // Elchi backoff 1m/5m/15m, 4 urinish — ilgari 5 daqiqalik oyna 3- va
    // 4-urinishni 401 bilan o'ldirardi va hodisa permanently_failed bo'lardi.
    const { controller, checkout } = setup();
    const occurredAt = new Date(Date.now() - 25 * 60 * 1000).toISOString();
    const { request, signature } = req(elchiBody({ occurred_at: occurredAt }));

    await expect(controller.receive(request, signature)).resolves.toMatchObject(
      { received: true },
    );
    expect(checkout.send).toHaveBeenCalled();
  });

  it('juda eski (2 soatlik) va kelajakdagi vaqt rad etiladi', async () => {
    const { controller } = setup();

    const old = req(
      elchiBody({
        occurred_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      }),
    );
    await expect(
      controller.receive(old.request, old.signature),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    const future = req(
      elchiBody({
        occurred_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      }),
    );
    await expect(
      controller.receive(future.request, future.signature),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('noma’lum status imzodan KEYIN 400 beradi', async () => {
    const { controller, checkout } = setup();
    const { request, signature } = req(elchiBody({ status: 'qwerty' }));

    await expect(controller.receive(request, signature)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(checkout.send).not.toHaveBeenCalled();
  });
});
