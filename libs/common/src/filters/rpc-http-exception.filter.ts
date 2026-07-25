import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  RpcExceptionFilter,
} from '@nestjs/common';
import { Observable, throwError } from 'rxjs';
import { STATUS_TO_ERROR_CODE } from '../constants/error-codes';

/**
 * Microservice ichidagi HttpException ma'lumotlarini RMQ orqali gateway'ga
 * yo'qotmasdan uzatadi. Nest'ning standart RPC filtri aks holda statusni
 * faqat "error" satriga aylantirib yuboradi.
 */
@Catch(HttpException)
export class RpcHttpExceptionFilter implements RpcExceptionFilter<HttpException> {
  catch(exception: HttpException, _host: ArgumentsHost): Observable<never> {
    const statusCode = exception.getStatus();
    const raw = exception.getResponse();

    let message: string | string[] = exception.message;
    let errorCode =
      STATUS_TO_ERROR_CODE[statusCode] ??
      STATUS_TO_ERROR_CODE[HttpStatus.INTERNAL_SERVER_ERROR];

    if (typeof raw === 'string') {
      message = raw;
    } else if (raw && typeof raw === 'object') {
      const response = raw as Record<string, unknown>;
      if (
        typeof response.message === 'string' ||
        Array.isArray(response.message)
      )
        message = response.message as string | string[];
      if (typeof response.errorCode === 'string')
        errorCode = response.errorCode as typeof errorCode;
    }

    return throwError(() => ({ statusCode, message, errorCode }));
  }
}
