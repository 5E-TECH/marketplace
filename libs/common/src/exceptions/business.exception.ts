import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from '../constants/error-codes';

/**
 * Biznes qoidasi buzilganda tashlanadigan exception — o'zi bilan barqaror
 * `errorCode` ni olib yuradi (masalan INSUFFICIENT_STOCK, INVALID_STATE).
 * Filter (all-exceptions) shu kodni javobga chiqaradi.
 */
export class BusinessException extends HttpException {
  constructor(
    message: string,
    public readonly errorCode: ErrorCode = ErrorCode.BUSINESS_RULE_VIOLATION,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
  ) {
    super({ message, errorCode }, status);
  }

  static insufficientStock(message = 'Qoldiq yetarli emas') {
    return new BusinessException(
      message,
      ErrorCode.INSUFFICIENT_STOCK,
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }

  static invalidState(message = 'Holat bu amalga ruxsat bermaydi') {
    return new BusinessException(
      message,
      ErrorCode.INVALID_STATE,
      HttpStatus.CONFLICT,
    );
  }

  static conflict(message = 'Bunday yozuv allaqachon mavjud') {
    return new BusinessException(
      message,
      ErrorCode.CONFLICT,
      HttpStatus.CONFLICT,
    );
  }
}
