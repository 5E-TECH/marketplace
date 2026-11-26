import { ConfigService } from '@nestjs/config';
import { NEVER, of } from 'rxjs';
import { openPayoutToken, PAYOUT_EVENTS, signHmacSha256 } from '@app/common';
import { PayoutWebhookController } from './payout-webhook.controller';

const SECRET = 'payout-webhook-secret-1';
const KEY = 'payout-secret-key-0123456789abcdef0123';
const REF = '3f0e2f5c-7a1e-4c55-9b0a-0d4c9b1f2a10';

/** BE-32 (MOL-6): kartaga to‘lov provayderi webhooki → finance hodisasi; token navbatga shifrlangan holda. */
describe('PayoutWebhookController', () => {
  const setup = (
    emit: jest.Mock = jest.fn(() => of(undefined)),
    env: Record<string, string | undefined> = {
      PAYOUT_WEBHOOK_SECRET: SECRET,
      PAYOUT_SECRET_KEY: KEY,
    },
  ) => {
    const controller = new PayoutWebhookController(
      { emit } as never,
      new ConfigService(env),
    );
    const send = (body: unknown, signature?: string) => {
      const raw = JSON.stringify(body);
      return controller.receive(
        { rawBody: Buffer.from(raw), body } as never,
        signature ?? signHmacSha256(raw, SECRET),
      );
    };
    return { emit, send };
  };

  it('card.bound: token shifrlanadi, ortiqcha maydon (to‘liq karta raqami) navbatga tushmaydi', async () => {
    const { emit, send } = setup();
    await expect(
      send({
        type: 'card.bound',
        eventId: 'evt-1',
        sessionRef: REF,
        cardToken: 'tok_A1b2C3d4E5f6',
        mask: '8600 **** **** 1234',
        system: 'UZCARD',
        holderName: ' AZIZA KARIMOVA ',
        pan: '8600123412341234',
      }),
    ).resolves.toMatchObject({ received: true });
    const [[pattern, payload]] = emit.mock.calls;
    expect(pattern).toBe(PAYOUT_EVENTS.CARD_BOUND);
    expect(Object.keys(payload).sort()).toEqual(
      [
        'eventId',
        'holderName',
        'mask',
        'sessionRef',
        'system',
        'tokenCipher',
      ].sort(),
    );
    expect(payload).toMatchObject({
      eventId: 'evt-1',
      sessionRef: REF,
      mask: '8600 **** **** 1234',
      system: 'UZCARD',
      holderName: 'AZIZA KARIMOVA',
    });
    expect(JSON.stringify(payload)).not.toContain('tok_A1b2C3d4E5f6');
    expect(JSON.stringify(payload)).not.toContain('8600123412341234');
    expect(openPayoutToken(payload.tokenCipher, KEY)).toBe('tok_A1b2C3d4E5f6');
  });

  it('payout.status → finance', async () => {
    const { emit, send } = setup();
    await send({
      type: 'payout.status',
      eventId: 'evt-2',
      payoutRef: 'wd-12',
      status: 'FAILED',
      reason: 'Karta bloklangan',
    });
    expect(emit).toHaveBeenCalledWith(PAYOUT_EVENTS.STATUS, {
      eventId: 'evt-2',
      payoutRef: 'wd-12',
      status: 'FAILED',
      reason: 'Karta bloklangan',
    });
  });

  it('imzo yo‘q yoki noto‘g‘ri — 401; ochiq raqamli niqob va noto‘g‘ri payoutRef — 400', async () => {
    const { emit, send } = setup();
    const body = {
      type: 'payout.status',
      eventId: 'evt-3',
      payoutRef: 'wd-1',
      status: 'SUCCESS',
    };
    await expect(send(body, 'deadbeef')).rejects.toMatchObject({ status: 401 });
    await expect(
      setup(jest.fn(), { PAYOUT_SECRET_KEY: KEY }).send(body),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      send({
        type: 'card.bound',
        eventId: 'evt-4',
        sessionRef: REF,
        cardToken: 'tok_A1b2C3d4E5f6',
        mask: '8600123412341234',
      }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(send({ ...body, payoutRef: '12' })).rejects.toMatchObject({
      status: 400,
    });
    expect(emit).not.toHaveBeenCalled();
  });

  it('kalit yo‘q yoki navbat javob bermasa — 503 (provayder qayta yuboradi)', async () => {
    const body = {
      type: 'payout.status',
      eventId: 'evt-5',
      payoutRef: 'wd-1',
      status: 'SUCCESS',
    };
    await expect(
      setup(
        jest.fn(() => of(undefined)),
        {
          PAYOUT_WEBHOOK_SECRET: SECRET,
        },
      ).send(body),
    ).rejects.toMatchObject({ status: 503 });
    jest.useFakeTimers();
    const pending = setup(jest.fn(() => NEVER)).send(body);
    const assertion = expect(pending).rejects.toMatchObject({ status: 503 });
    await jest.advanceTimersByTimeAsync(5_000);
    await assertion;
    jest.useRealTimers();
  });
});
