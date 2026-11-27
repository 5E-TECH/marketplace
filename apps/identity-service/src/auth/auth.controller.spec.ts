import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode, RegisterDto } from '@app/common';
import { AuthController } from './auth.controller';

describe('AuthController (identity)', () => {
  it('BE-06: `auth.register` (parol bilan ochiq ro‘yxat) yopiq — doim 410 BUSINESS_RULE_VIOLATION', () => {
    const controller = new AuthController({} as never);
    let error: unknown;
    try {
      controller.register({} as RegisterDto);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(HttpStatus.GONE);
    expect((error as HttpException).getResponse()).toMatchObject({
      errorCode: ErrorCode.BUSINESS_RULE_VIOLATION,
    });
  });
});
