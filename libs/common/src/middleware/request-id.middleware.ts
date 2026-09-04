import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { RequestContext } from '../context/request-context';

export const REQUEST_ID_HEADER = 'x-request-id';

/** Tashqaridan kelgan ID faqat xavfsiz belgilardan iborat bo'lsa qabul qilinadi. */
const MAX_REQUEST_ID_LENGTH = 128;
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]+$/;

interface RequestLike {
  headers?: Record<string, string | string[] | undefined>;
  requestId?: string;
}

interface ResponseLike {
  setHeader(name: string, value: string): void;
}

/**
 * Har so'rovga kuzatuv identifikatori biriktiradi:
 *  - `X-Request-Id` sarlavhasi kelgan bo'lsa (va xavfsiz bo'lsa) — o'shani ishlatadi,
 *  - aks holda yangi UUID generatsiya qiladi.
 * ID javob sarlavhasiga qaytariladi va `RequestContext` orqali log/xato
 * filtriga yetib boradi. Foydalanuvchi shikoyat qilgan xatoni log'dan
 * shu ID bo'yicha topish mumkin.
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: RequestLike, res: ResponseLike, next: () => void): void {
    const incoming = req.headers?.[REQUEST_ID_HEADER];
    const candidate = Array.isArray(incoming) ? incoming[0] : incoming;
    const requestId =
      typeof candidate === 'string' &&
      candidate.length > 0 &&
      candidate.length <= MAX_REQUEST_ID_LENGTH &&
      SAFE_REQUEST_ID.test(candidate)
        ? candidate
        : randomUUID();

    req.requestId = requestId;
    res.setHeader('X-Request-Id', requestId);

    RequestContext.run({ requestId }, () => next());
  }
}
