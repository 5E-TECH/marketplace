import { HttpException, HttpStatus } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  catchError,
  firstValueFrom,
  throwError,
  timeout,
  TimeoutError,
} from 'rxjs';

export const RPC_TIMEOUT_MS = 10_000;

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
      timeout(RPC_TIMEOUT_MS),
      catchError((err: any) => {
        if (err instanceof TimeoutError) {
          return throwError(
            () =>
              new HttpException(
                'Mikroservis belgilangan vaqtda javob bermadi',
                HttpStatus.GATEWAY_TIMEOUT,
              ),
          );
        }

        const candidateStatus = err?.statusCode ?? err?.status;
        const status =
          typeof candidateStatus === 'number' &&
          candidateStatus >= 100 &&
          candidateStatus <= 599
            ? candidateStatus
            : HttpStatus.INTERNAL_SERVER_ERROR;
        const message = err?.message ?? 'Ichki xato';
        const response = err?.errorCode
          ? { message, errorCode: err.errorCode }
          : message;
        return throwError(() => new HttpException(response, status));
      }),
    ),
  );
}
