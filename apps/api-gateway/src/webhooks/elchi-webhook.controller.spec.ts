import { UnauthorizedException } from '@nestjs/common';
import { of } from 'rxjs';
import { signHmacSha256 } from '@app/common';
import { ElchiWebhookController } from './elchi-webhook.controller';

describe('ElchiWebhookController (C2.4)', () => {
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

  it('to‘g‘ri HMAC bilan webhookni checkoutga uzatadi', async () => {
    const { controller, checkout } = setup();
    const payload = body();
    const rawBody = JSON.stringify(payload);

    await expect(
      controller.receive(
        { rawBody: Buffer.from(rawBody) } as never,
        signHmacSha256(rawBody, secret),
        payload as never,
      ),
    ).resolves.toMatchObject({ received: true });
    expect(checkout.send).toHaveBeenCalledWith(
      { cmd: 'checkout.elchi-webhook.process' },
      payload,
    );
  });

  it('noto‘g‘ri HMACni 401 bilan rad etadi', async () => {
    const { controller, checkout } = setup();
    const payload = body();

    await expect(
      controller.receive(
        { rawBody: Buffer.from(JSON.stringify(payload)) } as never,
        'invalid',
        payload as never,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(checkout.send).not.toHaveBeenCalled();
  });
});
