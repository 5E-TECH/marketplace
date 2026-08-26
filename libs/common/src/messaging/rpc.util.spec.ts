import { HttpException, HttpStatus } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { NEVER, of, throwError } from 'rxjs';
import { RPC_TIMEOUT_MS, sendRpc } from './rpc.util';

describe('sendRpc', () => {
  const client = {
    send: jest.fn(),
  } as unknown as ClientProxy;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('microservice javobini qaytaradi', async () => {
    jest.mocked(client.send).mockReturnValue(of({ ok: true }));

    await expect(sendRpc(client, { cmd: 'test' }, {})).resolves.toEqual({
      ok: true,
    });
  });

  it('javob kelmasa 504 qaytaradi', async () => {
    jest.useFakeTimers();
    jest.mocked(client.send).mockReturnValue(NEVER);

    const result = sendRpc(client, { cmd: 'test' }, {});
    const expectation = expect(result).rejects.toMatchObject({
      status: HttpStatus.GATEWAY_TIMEOUT,
      message: 'Mikroservis belgilangan vaqtda javob bermadi',
    });
    await jest.advanceTimersByTimeAsync(RPC_TIMEOUT_MS);

    await expectation;
    jest.useRealTimers();
  });

  it('microservice HTTP xatosining status va errorCode qiymatini saqlaydi', async () => {
    jest.mocked(client.send).mockReturnValue(
      throwError(() => ({
        statusCode: HttpStatus.NOT_FOUND,
        message: 'Topilmadi',
        errorCode: 'ITEM_NOT_FOUND',
      })),
    );

    try {
      await sendRpc(client, { cmd: 'test' }, {});
      fail('sendRpc xato qaytarishi kerak edi');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      const exception = error as HttpException;
      expect(exception.getStatus()).toBe(HttpStatus.NOT_FOUND);
      expect(exception.getResponse()).toEqual({
        message: 'Topilmadi',
        errorCode: 'ITEM_NOT_FOUND',
      });
    }
  });
});
