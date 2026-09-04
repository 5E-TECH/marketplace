/** Muvaffaqiyatli javob qobig'i — API_CONTRACT.md §1.3. */
export interface ApiResponse<T = unknown> {
  statusCode: number;
  message: string;
  data: T;
}

/** Xato javob qobig'i — API_CONTRACT.md §1.5. */
export interface ApiErrorResponse {
  statusCode: number;
  message: string | string[];
  errorCode: string;
  details?: Array<{ field: string; error: string }>;
  /** Kuzatuv identifikatori — log bilan solishtirish uchun (X-Request-Id). */
  requestId?: string;
}
