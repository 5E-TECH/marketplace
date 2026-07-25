import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiResponse } from '../interfaces/api-response.interface';

export const RAW_RESPONSE_MARKER = '__rawResponse';

export function rawResponse<T extends object>(
  data: T,
): T & { __rawResponse: true } {
  return Object.assign(data, {
    [RAW_RESPONSE_MARKER]: true as const,
  }) as T & { __rawResponse: true };
}

/**
 * Har controller javobini yagona qobiqqa o'raydi: {statusCode, message, data}.
 * API_CONTRACT.md §1.3. Agar handler allaqachon {message,data} qaytarsa — hurmat qilinadi.
 */
@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<
  T,
  ApiResponse<T>
> {
  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<ApiResponse<T>> {
    const res = context.switchToHttp().getResponse();
    return next.handle().pipe(
      map((payload: any) => {
        const statusCode: number = res.statusCode ?? 200;
        if (
          payload &&
          typeof payload === 'object' &&
          payload[RAW_RESPONSE_MARKER] === true
        ) {
          const { [RAW_RESPONSE_MARKER]: _, ...data } = payload;
          return data as ApiResponse<T>;
        }
        if (
          payload &&
          typeof payload === 'object' &&
          'data' in payload &&
          'message' in payload
        ) {
          return { statusCode, message: payload.message, data: payload.data };
        }
        return { statusCode, message: 'OK', data: payload ?? null };
      }),
    );
  }
}
