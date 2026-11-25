import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  PayloadTooLargeException,
} from '@nestjs/common';
import { catchError, Observable, throwError } from 'rxjs';
import { ErrorCode } from '@app/common';

/** Multer chegarasi (413) frontend kutadigan `FILE_TOO_LARGE` kodi bilan. */
@Injectable()
export class PhotoTooLargeInterceptor implements NestInterceptor {
  intercept(
    _context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    return next.handle().pipe(
      catchError((error: unknown) =>
        throwError(() =>
          error instanceof PayloadTooLargeException
            ? new PayloadTooLargeException({
                message: 'Rasm 5 MB dan katta',
                errorCode: ErrorCode.FILE_TOO_LARGE,
              })
            : error,
        ),
      ),
    );
  }
}
