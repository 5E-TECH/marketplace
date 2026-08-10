import { NotFoundException } from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';
import { BusinessException } from '../exceptions/business.exception';
import { ErrorCode } from '../constants/error-codes';

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
        'Request hajmi juda katta. Rasmlarni /api/v1/files/upload orqali yuboring',
      errorCode: ErrorCode.PAYLOAD_TOO_LARGE,
    });
  });
});
