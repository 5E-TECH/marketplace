import { NotFoundException } from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';
import { BusinessException } from '../exceptions/business.exception';
import { ErrorCode } from '../constants/error-codes';
import { throwError } from 'rxjs';
import { RpcHttpExceptionFilter } from './rpc-http-exception.filter';
import { sendRpc } from '../messaging/rpc.util';

// TC2: xato filtri to'g'ri statusCode + errorCode beradi
describe('AllExceptionsFilter (TC2)', () => {
  const makeHost = () => {
    const json = jest.fn();
    const status = jest.fn(() => ({ json }));
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({ status }),
        getRequest: () => ({ method: 'GET', url: '/test' }),
      }),
    } as any;
    return { host, status, json };
  };

  it('NotFoundException -> 404 NOT_FOUND', () => {
    const { host, status, json } = makeHost();
    new AllExceptionsFilter().catch(new NotFoundException('topilmadi'), host);
    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 404,
        errorCode: ErrorCode.NOT_FOUND,
      }),
    );
  });

  it('BusinessException custom errorCode ni saqlaydi', () => {
    const { host, status, json } = makeHost();
    new AllExceptionsFilter().catch(
      BusinessException.insufficientStock(),
      host,
    );
    expect(status).toHaveBeenCalledWith(422);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 422,
        errorCode: ErrorCode.INSUFFICIENT_STOCK,
      }),
    );
  });

  it('kutilmagan xato -> 500 INTERNAL_ERROR', () => {
    const { host, status, json } = makeHost();
    new AllExceptionsFilter().catch(new Error('boom'), host);
    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 500,
        errorCode: ErrorCode.INTERNAL_ERROR,
      }),
    );
  });

  it('body-parser katta request xatosi -> 413 PAYLOAD_TOO_LARGE', () => {
    const { host, status, json } = makeHost();
    const error = Object.assign(new Error('request entity too large'), {
      type: 'entity.too.large',
      status: 413,
    });

    new AllExceptionsFilter().catch(error, host);

    expect(status).toHaveBeenCalledWith(413);
    expect(json).toHaveBeenCalledWith({
      statusCode: 413,
      message:
        'Request hajmi juda katta. Fayllarni alohida yuklash yo‘li orqali yuboring',
      errorCode: ErrorCode.PAYLOAD_TOO_LARGE,
    });
  });

  it('BE-06: BusinessException qo‘shimcha maydonlari javobga va Retry-After sarlavhasiga; asosiylarni almashtirmaydi', () => {
    const json = jest.fn();
    const setHeader = jest.fn();
    const status = jest.fn(() => ({ json }));
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({ status, setHeader }),
        getRequest: () => ({ method: 'POST', url: '/api/v1/auth/otp/verify' }),
      }),
    } as never;
    new AllExceptionsFilter().catch(
      new BusinessException('blok', ErrorCode.OTP_BLOCKED, 423, {
        retryAfterSeconds: 900,
        statusCode: 200,
      }),
      host,
    );
    expect(status).toHaveBeenCalledWith(423);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 423,
        errorCode: 'OTP_BLOCKED',
        retryAfterSeconds: 900,
      }),
    );
    expect(setHeader).toHaveBeenCalledWith('Retry-After', '900');
  });

  it('BE-06: RPC zanjiri — RpcHttpExceptionFilter → sendRpc qo‘shimcha maydonni (attemptsLeft) saqlaydi', async () => {
    const thrown = await new Promise<Record<string, unknown>>((resolve) =>
      new RpcHttpExceptionFilter()
        .catch(
          new BusinessException('Kod noto‘g‘ri', ErrorCode.OTP_INVALID, 400, {
            attemptsLeft: 2,
          }),
          {} as never,
        )
        .subscribe({ error: resolve }),
    );
    expect(thrown).toEqual({
      statusCode: 400,
      message: 'Kod noto‘g‘ri',
      errorCode: 'OTP_INVALID',
      extra: { attemptsLeft: 2 },
    });
    const client = { send: () => throwError(() => thrown) };
    await expect(
      sendRpc(client as never, { cmd: 'x' }, {}),
    ).rejects.toMatchObject({
      response: { errorCode: 'OTP_INVALID', extra: { attemptsLeft: 2 } },
      status: 400,
    });
  });
});
