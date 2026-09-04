import { AsyncLocalStorage } from 'async_hooks';

/**
 * So'rov davomida saqlanadigan kontekst — log va xato javoblarida bir xil
 * `requestId` ko'rsatish uchun. `RequestIdMiddleware` to'ldiradi.
 */
export interface RequestStore {
  requestId: string;
}

const storage = new AsyncLocalStorage<RequestStore>();

export const RequestContext = {
  /** Berilgan kontekst ichida funksiyani ishga tushiradi. */
  run<T>(store: RequestStore, fn: () => T): T {
    return storage.run(store, fn);
  },

  /** Joriy so'rovning requestId'si (kontekst tashqarisida — undefined). */
  requestId(): string | undefined {
    return storage.getStore()?.requestId;
  },
};
