import {
  BadRequestException,
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  PayloadTooLargeException,
} from '@nestjs/common';
import { catchError, Observable, throwError } from 'rxjs';
import { ErrorCode, RETURN_PHOTO_MAX } from '@app/common';

/** Multer xatolari (inglizcha, kodsiz) frontend kutadigan kod va matn bilan. */
@Injectable()
export class PhotoTooLargeInterceptor implements NestInterceptor {
  intercept(
    _context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    return next
      .handle()
      .pipe(catchError((error: unknown) => throwError(() => translate(error))));
  }
}

function translate(error: unknown): unknown {
  if (error instanceof PayloadTooLargeException)
    return new PayloadTooLargeException({
      message: 'Rasm 5 MB dan katta',
      errorCode: ErrorCode.FILE_TOO_LARGE,
    });
  if (
    error instanceof BadRequestException &&
    /^(Too many files|Unexpected field)/.test(error.message)
  )
    return new BadRequestException({
      message: `\`files\` maydonida ${RETURN_PHOTO_MAX} tagacha rasm yuboriladi`,
      errorCode: ErrorCode.FILE_REQUIRED,
    });
  return error;
}
