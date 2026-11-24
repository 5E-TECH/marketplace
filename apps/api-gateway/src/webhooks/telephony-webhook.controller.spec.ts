import { ConfigService } from '@nestjs/config';
import { NEVER, of, throwError } from 'rxjs';
import { CALL_EVENTS, signHmacSha256 } from '@app/common';
import { TelephonyWebhookController } from './telephony-webhook.controller';

const SECRET = 'telephony-webhook-secret-1';
const REF = '3f0e2f5c-7a1e-4c55-9b0a-0d4c9b1f2a10';
const base = { eventId: 'evt-1', callRef: REF, at: '2026-12-01T09:00:00.000Z' };

/** BE-15 (TEL-3): provayder webhooki → RabbitMQ hodisasi. */
describe('TelephonyWebhookController', () => {
  const setup = (
    emit: jest.Mock = jest.fn(() => of(undefined)),
    secret: string | undefined = SECRET,
  ) => {
    const controller = new TelephonyWebhookController(
      { emit } as never,
      new ConfigService({ TELEPHONY_WEBHOOK_SECRET: secret }),
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

  it('bosqich, tugash va yozuv — o‘z hodisasiga; ortiqcha maydon (mijoz raqami) navbatga tushmaydi', async () => {
    const { emit, send } = setup();
    await expect(
      send({
        ...base,
        type: 'status',
        status: 'CONNECTED',
        customer: '+998901234567',
      }),
    ).resolves.toMatchObject({ received: true });
    await send({
      ...base,
      type: 'completed',
      endReason: 'ANSWERED',
      answeredAt: '2026-12-01T14:00:00+05:00',
      durationSeconds: 118,
    });
    await send({ ...base, type: 'completed', endReason: 'NO_ANSWER' });
    await send({ ...base, type: 'recording', recordingRef: 'rec-5521' });
    expect(emit.mock.calls).toEqual([
      [CALL_EVENTS.STATUS, { ...base, status: 'CONNECTED' }],
      [
        CALL_EVENTS.COMPLETED,
        {
          ...base,
          endReason: 'ANSWERED',
          answeredAt: '2026-12-01T09:00:00.000Z', // UTC ga keltiriladi
          durationSeconds: 118,
        },
      ],
      [
        CALL_EVENTS.COMPLETED,
        {
          ...base,
          endReason: 'NO_ANSWER',
          answeredAt: null,
          durationSeconds: null,
        },
      ],
      [CALL_EVENTS.RECORDING_READY, { ...base, recordingRef: 'rec-5521' }],
    ]);
  });

  it('imzo yo‘q, noto‘g‘ri yoki kalit sozlanmagan — 401, navbatga yozilmaydi', async () => {
    const body = { ...base, type: 'completed', endReason: 'BUSY' };
    const { emit, send } = setup();
    await expect(send(body, 'x')).rejects.toMatchObject({ status: 401 });
    await expect(send(body, '')).rejects.toMatchObject({ status: 401 });
    await expect(
      send(body, signHmacSha256(JSON.stringify(body), 'boshqa-kalit-000000')),
    ).rejects.toMatchObject({ status: 401 });
    for (const secret of ['', undefined]) {
      const off = new TelephonyWebhookController(
        { emit } as never,
        new ConfigService({ TELEPHONY_WEBHOOK_SECRET: secret }),
      );
      const raw = JSON.stringify(body);
      await expect(
        off.receive(
          { rawBody: Buffer.from(raw), body } as never,
          signHmacSha256(raw, ''),
        ),
      ).rejects.toMatchObject({ status: 401 });
    }
    expect(emit).not.toHaveBeenCalled();
  });

  it.each([
    ['noma’lum tur', { ...base, type: 'hangup' }],
    ['status yo‘q', { ...base, type: 'status' }],
    [
      'status ENDED (bosqich emas)',
      { ...base, type: 'status', status: 'ENDED' },
    ],
    ['tugash sababi yo‘q', { ...base, type: 'completed' }],
    [
      'suhbat bo‘lgan, javob vaqti yo‘q',
      { ...base, type: 'completed', endReason: 'ANSWERED', durationSeconds: 5 },
    ],
    [
      'manfiy davomiylik',
      {
        ...base,
        type: 'completed',
        endReason: 'ANSWERED',
        answeredAt: base.at,
        durationSeconds: -1,
      },
    ],
    ['yozuv kaliti yo‘q', { ...base, type: 'recording' }],
    [
      'yozuv kalitida bo‘shliq',
      { ...base, type: 'recording', recordingRef: 'a b' },
    ],
    [
      'callRef UUID emas',
      { ...base, callRef: '12', type: 'recording', recordingRef: 'r' },
    ],
    [
      'vaqt noto‘g‘ri',
      { ...base, at: 'kecha', type: 'recording', recordingRef: 'r' },
    ],
    ...[
      '2027-01-14T09:36:00+05',
      '20270114T093600Z',
      '2027-W03-4',
      '2027-01-14T09:36:00',
      '2027-13-45T09:36:00Z',
    ].map(
      (at) =>
        [
          `vaqt ${at}`,
          { ...base, at, type: 'recording', recordingRef: 'r' },
        ] as [string, unknown],
    ),
    ['massiv', [base]],
  ])('yaroqsiz tana (%s) — 400', async (_name, body) => {
    const { emit, send } = setup();
    await expect(send(body)).rejects.toMatchObject({ status: 400 });
    expect(emit).not.toHaveBeenCalled();
  });

  it('navbatga yozilmadi — 503 (provayder qayta yuboradi); osilib qolsa 5 s', async () => {
    const body = { ...base, type: 'recording', recordingRef: 'r' };
    const broken = setup(
      jest.fn(() => throwError(() => new Error('rmq yo‘q'))),
    );
    await expect(broken.send(body)).rejects.toMatchObject({ status: 503 });
    jest.useFakeTimers();
    const hung = setup(jest.fn(() => NEVER)).send(body);
    const result = expect(hung).rejects.toMatchObject({ status: 503 });
    await jest.advanceTimersByTimeAsync(5_000);
    await result;
    jest.useRealTimers();
  });
});
