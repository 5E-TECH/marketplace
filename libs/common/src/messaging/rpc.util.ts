import { HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  catchError,
  firstValueFrom,
  throwError,
  timeout,
  TimeoutError,
} from 'rxjs';

export const RPC_TIMEOUT_MS = 10_000;

const logger = new Logger('sendRpc');

/**
 * Mijozga ko'rsatiladigan umumiy xabar. Ichki tafsilot (SQL constraint nomi,
 * "no matching message handler", stack) faqat log'ga tushadi.
 */
const INTERNAL_MESSAGE = 'Ichki xato. Birozdan so‘ng qayta urinib ko‘ring';

/**
 * Gateway'dan microservice'ga RMQ orqali so'rov yuboradi va javobni kutadi.
 * Microservice tashlagan xato (HttpException) serializatsiya bo'lib qaytadi —
 * uni to'g'ri HTTP status + errorCode bilan qayta tashlaymiz (AllExceptionsFilter
 * uni yakuniy javobga aylantiradi).
 *
 * Servis HttpException emas, oddiy xato tashlasa (TypeORM `QueryFailedError`,
 * servis o'chiq bo'lsa RMQ ning "no matching message handler" xabari) — uning
 * matni mijozga ketmaydi: 4xx faqat ataylab qo'yilgan xabarni olib o'tadi,
 * qolgani umumiy xabarga almashtiriladi.
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
        const clientFacing = status < HttpStatus.INTERNAL_SERVER_ERROR;
        if (!clientFacing) {
          logger.error(
            `${JSON.stringify(pattern)} → ${status}: ${String(
              err?.message ?? err,
            )}`,
            err?.stack,
          );
        }
        const message = clientFacing
          ? (err?.message ?? INTERNAL_MESSAGE)
          : INTERNAL_MESSAGE;
        const response = err?.errorCode
          ? { message, errorCode: err.errorCode }
          : message;
        return throwError(() => new HttpException(response, status));
      }),
    ),
  );
}
