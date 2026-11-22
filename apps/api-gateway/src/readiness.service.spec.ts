import { of, throwError } from 'rxjs';
import { ReadinessService } from './readiness.service';

describe('ReadinessService (C4.7)', () => {
  const client = () => ({
    send: jest.fn(() => of({ status: 'ok', ready: true })),
  });
  const makeService = (clients: ReturnType<typeof client>[]) =>
    new ReadinessService(
      clients[0] as never,
      clients[1] as never,
      clients[2] as never,
      clients[3] as never,
      clients[4] as never,
      clients[5] as never,
      clients[6] as never,
      clients[7] as never,
      clients[8] as never,
      clients[9] as never,
      clients[10] as never,
    );

  it('TC1: barcha servislar sog‘lom bo‘lsa ready qaytaradi', async () => {
    const clients = Array.from({ length: 11 }, client);
    const service = makeService(clients);
    await expect(service.check()).resolves.toMatchObject({ status: 'ready' });
    expect(clients.every((item) => item.send.mock.calls.length === 1)).toBe(
      true,
    );
  });

  it('bitta servis javob bermasa 503 beradi', async () => {
    const clients = Array.from({ length: 11 }, client);
    clients[2].send.mockImplementation(() =>
      throwError(() => new Error('down')),
    );
    const service = makeService(clients);
    await expect(service.check()).rejects.toMatchObject({ status: 503 });
  });
});
