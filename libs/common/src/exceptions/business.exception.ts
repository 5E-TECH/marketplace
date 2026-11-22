import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from '../constants/error-codes';

/** Xato javobidagi qo‘shimcha maydonlar — faqat oddiy qiymatlar. */
export type ErrorExtra = Record<string, string | number | boolean | null>;

/** `extra` ni tekshiradi: faqat oddiy qiymatli obyekt o‘tadi (boshqa narsa tashlanadi). */
export function errorExtraOf(value: unknown): ErrorExtra | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return undefined;
  const out: ErrorExtra = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>))
    if (v === null || ['string', 'number', 'boolean'].includes(typeof v))
      out[k] = v as string | number | boolean | null;
  return Object.keys(out).length ? out : undefined;
}

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
    /**
     * BE-06: javobga qo‘shimcha maydonlar (masalan `attemptsLeft`, `retryAfterSeconds`) — RPC orqali gateway
     * javobigacha yetadi (`RpcHttpExceptionFilter` → `sendRpc` → `AllExceptionsFilter`).
     */
    extra?: ErrorExtra,
  ) {
    super(
      extra ? { message, errorCode, extra } : { message, errorCode },
      status,
    );
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
