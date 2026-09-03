import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { RequestContext } from '../context/request-context';

/**
 * Har HTTP so'rov uchun bitta kirish log satri: requestId, metod, yo'l,
 * status va davomiylik. Xatolar `AllExceptionsFilter`da alohida loglanadi.
 */
@Injectable()
export class HttpLoggerInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const http = context.switchToHttp();
    const request = http.getRequest<{ method?: string; url?: string }>();
    const response = http.getResponse<{ statusCode?: number }>();
    const startedAt = Date.now();
    const requestId = RequestContext.requestId() ?? '-';

    const write = (status: number | string) => {
      const ms = Date.now() - startedAt;
      this.logger.log(
        `[${requestId}] ${request?.method} ${request?.url} → ${status} (${ms}ms)`,
      );
    };

    return next.handle().pipe(
      tap({
        next: () => write(response?.statusCode ?? 200),
        error: (error: { status?: number; statusCode?: number }) =>
          write(error?.status ?? error?.statusCode ?? 500),
      }),
    );
  }
}
