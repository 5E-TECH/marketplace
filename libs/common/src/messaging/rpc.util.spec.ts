import { HttpException, HttpStatus, Logger } from '@nestjs/common';
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

  it('xom ichki xato mijozga ko‘rsatilmaydi, faqat log‘ga tushadi', async () => {
    const log = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    jest
      .mocked(client.send)
      .mockReturnValue(
        throwError(
          () =>
            new Error(
              'duplicate key value violates unique constraint "uq_payment_order"',
            ),
        ),
      );

    try {
      await sendRpc(client, { cmd: 'payment.create' }, {});
      fail('sendRpc xato qaytarishi kerak edi');
    } catch (error) {
      const exception = error as HttpException;
      expect(exception.getStatus()).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(exception.getResponse()).toBe(
        'Ichki xato. Birozdan so‘ng qayta urinib ko‘ring',
      );
    }
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('unique constraint'),
      expect.anything(),
    );
    log.mockRestore();
  });

  it('servis o‘chiq bo‘lsa RMQ xabari sizib chiqmaydi', async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    jest.mocked(client.send).mockReturnValue(
      throwError(() => ({
        message:
          'There is no matching message handler defined in the remote service.',
      })),
    );

    await expect(sendRpc(client, { cmd: 'test' }, {})).rejects.toMatchObject({
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Ichki xato. Birozdan so‘ng qayta urinib ko‘ring',
    });
    jest.restoreAllMocks();
  });

  it('servis ataylab qo‘ygan 4xx xabari o‘zgarmaydi', async () => {
    jest.mocked(client.send).mockReturnValue(
      throwError(() => ({
        statusCode: HttpStatus.BAD_REQUEST,
        message: 'Savat bo‘sh',
      })),
    );

    await expect(sendRpc(client, { cmd: 'test' }, {})).rejects.toMatchObject({
      status: HttpStatus.BAD_REQUEST,
      message: 'Savat bo‘sh',
    });
  });
});
