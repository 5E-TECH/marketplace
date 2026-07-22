import { HttpException, HttpStatus } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { catchError, firstValueFrom, throwError } from 'rxjs';

/**
 * Gateway'dan microservice'ga RMQ orqali so'rov yuboradi va javobni kutadi.
 * Microservice tashlagan xato (HttpException) serializatsiya bo'lib qaytadi —
 * uni to'g'ri HTTP status + errorCode bilan qayta tashlaymiz (AllExceptionsFilter
 * uni yakuniy javobga aylantiradi).
 */
export function sendRpc<T = unknown>(
  client: ClientProxy,
  pattern: unknown,
  data: unknown,
): Promise<T> {
  return firstValueFrom(
    client.send<T>(pattern as any, data as any).pipe(
      catchError((err: any) => {
        const status =
          err?.status ?? err?.statusCode ?? HttpStatus.INTERNAL_SERVER_ERROR;
        const message = err?.message ?? 'Ichki xato';
        const response = err?.errorCode
          ? { message, errorCode: err.errorCode }
          : message;
        return throwError(() => new HttpException(response, status));
      }),
    ),
  );
}
