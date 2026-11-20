import { RMQ_ATTEMPT_HEADER, ReliableRmqServer } from './reliable-rmq.server';

/** Brokersiz: tasdiq qarorlari (BE-02). Haqiqiy broker bilan — reliable-rmq.integration.spec.ts. */
describe('ReliableRmqServer (BE-02)', () => {
  const make = (maxAttempts?: number) => {
    const server = new ReliableRmqServer(
      { urls: ['amqp://x'], queue: 'q_v2' },
      { maxAttempts, retryDelayMs: 1000 },
    );
    const failing = jest.fn(async () => {
      throw new Error('baza yo‘q');
    });
    server.addHandler('probe.fail', failing as never, true);
    server.addHandler(
      'probe.ok',
      jest.fn(async () => undefined) as never,
      true,
    );
    return { server, failing };
  };
  const channel = () => ({
    ack: jest.fn(),
    nack: jest.fn(),
    sendToQueue: jest.fn(() => true),
    assertQueue: jest.fn(),
  });
  const message = (
    pattern: string,
    opts: { redelivered?: boolean; attempt?: number } = {},
  ) => ({
    content: Buffer.from(JSON.stringify({ pattern, data: { id: 1 } })),
    properties: {
      headers:
        opts.attempt === undefined
          ? {}
          : { [RMQ_ATTEMPT_HEADER]: opts.attempt },
    },
    fields: { redelivered: opts.redelivered ?? false, deliveryTag: 1 },
  });

  it('iste’molchi o‘lib qayta yetkazilgan (redelivered) xabar urinish hisoblanmaydi — DLQ ga emas, qayta urinishga', async () => {
    const { server } = make();
    const ch = channel();
    await server.handleMessage(
      message('probe.fail', { redelivered: true }),
      ch,
    );
    expect(ch.sendToQueue).toHaveBeenCalledWith(
      'q_v2.retry',
      expect.any(Buffer),
      expect.objectContaining({
        persistent: true,
        headers: { [RMQ_ATTEMPT_HEADER]: 1 },
      }),
    );
    expect(ch.ack).toHaveBeenCalledTimes(1);
    expect(ch.nack).not.toHaveBeenCalled();
  });

  it('oxirgi urinish — DLQ (nack, qayta navbatsiz)', async () => {
    const { server } = make();
    const ch = channel();
    await server.handleMessage(message('probe.fail', { attempt: 2 }), ch);
    expect(ch.sendToQueue).not.toHaveBeenCalled();
    expect(ch.nack).toHaveBeenCalledWith(expect.anything(), false, false);
  });

  it('bildirishnoma (maxAttempts 1) — qayta urinishsiz DLQ', async () => {
    const { server } = make(1);
    const ch = channel();
    await server.handleMessage(message('probe.fail'), ch);
    expect(ch.sendToQueue).not.toHaveBeenCalled();
    expect(ch.nack).toHaveBeenCalledWith(expect.anything(), false, false);
  });

  it('kanal yopilgan (ack/nack xato tashlaydi) — jarayon yiqilmaydi', async () => {
    const { server } = make();
    const closed = channel();
    closed.ack.mockImplementation(() => {
      throw new Error('Channel closed');
    });
    closed.nack.mockImplementation(() => {
      throw new Error('Channel closed');
    });
    closed.sendToQueue.mockImplementation(() => {
      throw new Error('Channel closed');
    });
    await expect(
      server.handleMessage(message('probe.ok'), closed),
    ).resolves.toBeUndefined();
    await expect(
      server.handleMessage(message('probe.fail'), closed),
    ).resolves.toBeUndefined();
  });

  it('handleri yo‘q hodisa — tasdiqlanadi (DLQ ga emas)', async () => {
    const { server } = make();
    const ch = channel();
    await server.handleMessage(message('probe.unknown'), ch);
    expect(ch.ack).toHaveBeenCalledTimes(1);
    expect(ch.nack).not.toHaveBeenCalled();
  });

  it('tasdiqli kanal: retry nusxasi broker tasdiqlagach asl xabar tasdiqlanadi; tasdiq xatosi — asl xabar qayta navbatga', async () => {
    const { server } = make();
    const confirmed = {
      ...channel(),
      waitForConfirms: jest.fn(),
      sendToQueue: jest.fn(
        (_q: string, _c: Buffer, _o: unknown, cb: (e: unknown) => void) => {
          cb(null);
          return true;
        },
      ),
    };
    await server.handleMessage(message('probe.fail'), confirmed);
    expect(confirmed.ack).toHaveBeenCalledTimes(1);

    const rejected = {
      ...channel(),
      waitForConfirms: jest.fn(),
      sendToQueue: jest.fn(
        (_q: string, _c: Buffer, _o: unknown, cb: (e: unknown) => void) => {
          cb(new Error('nack'));
          return true;
        },
      ),
    };
    await server.handleMessage(message('probe.fail'), rejected);
    expect(rejected.ack).not.toHaveBeenCalled();
    expect(rejected.nack).toHaveBeenCalledWith(expect.anything(), false, true);
  });
});
