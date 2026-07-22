import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ErrorCode, STATUS_TO_ERROR_CODE } from '../constants/error-codes';
import { ApiErrorResponse } from '../interfaces/api-response.interface';

/**
 * Barcha xatolarni bir xil qobiqqa keltiradi — API_CONTRACT.md §1.5:
 *   { statusCode, message, errorCode, details? }
 * HttpException'dan status/message olinadi; kutilmagan xato → 500 INTERNAL_ERROR
 * (tafsilot log'ga, javobga emas).
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = 'Ichki xato';
    let errorCode: string = ErrorCode.INTERNAL_ERROR;
    let details: ApiErrorResponse['details'];

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      errorCode = STATUS_TO_ERROR_CODE[status] ?? ErrorCode.INTERNAL_ERROR;

      if (typeof res === 'string') {
        message = res;
      } else if (res && typeof res === 'object') {
        const r = res as Record<string, any>;
        message = r.message ?? exception.message;
        if (r.errorCode) errorCode = r.errorCode; // custom (BusinessException)
        // class-validator ro'yxati → details
        if (Array.isArray(r.message)) {
          details = r.message.map((m: string) => ({ field: '', error: m }));
        }
      }
    } else if (exception instanceof Error) {
      message = 'Ichki xato';
      this.logger.error(exception.message, exception.stack);
    }

    const body: ApiErrorResponse = { statusCode: status, message, errorCode };
    if (details) body.details = details;

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `${request?.method} ${request?.url} → ${status} ${errorCode}`,
      );
    }

    response.status(status).json(body);
  }
}
