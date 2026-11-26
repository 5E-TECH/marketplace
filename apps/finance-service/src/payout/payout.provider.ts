import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** Provayder javobini shundan ortiq kutmaymiz [taklif]; vaqt tugasa natija noma’lum — qayta yuborilmaydi. */
export const PAYOUT_TIMEOUT_MS = 10_000;

/** Ulanish bo‘lmagan — so‘rov provayderga yetmagan. */
const NOT_CONNECTED: ReadonlySet<string> = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'UND_ERR_CONNECT_TIMEOUT',
]);

/** Natija noma’lum (vaqt tugadi, 5xx, aloqa uzildi): pul ketgan bo‘lishi mumkin — `FAILED` deb yozilmaydi. */
export class PayoutUnknownError extends Error {}

/** Provayder aniq rad etdi yoki so‘rov unga yetmadi: pul ketmagan. */
export class PayoutRejectedError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number | null = null,
  ) {
    super(message);
  }
}

export type PayoutState = 'SUCCESS' | 'PENDING' | 'FAILED';

export interface PayoutResult {
  status: PayoutState;
  reason: string | null;
}

const STATES: ReadonlySet<string> = new Set(['SUCCESS', 'PENDING', 'FAILED']);

/**
 * Kartaga to‘lov provayderi (EQ-08; tavsiya Multicard) — bitta joy: provayder tanlangach shu klass uning API siga
 * yoziladi (yoki oraliq ko‘prik quyidagi umumiy shaklni gapiradi). `Authorization: Bearer <PAYOUT_API_TOKEN>`.
 * - `POST {URL}/card-sessions` `{sessionRef, returnUrl, pinfl}` → `{url}` — sotuvchi kartani provayder sahifasida kiritadi,
 *   bizga webhook bilan faqat token va niqob keladi;
 * - `POST {URL}/payouts` `{payoutRef, cardToken, amount, currency, purpose}` → `{status, reason?}`;
 * - `GET {URL}/payouts/{payoutRef}` → `{status, reason?}`; 404 — topilmadi (`null`).
 * Hodisalar — `POST /webhooks/payout` (gateway).
 */
@Injectable()
export class PayoutProvider {
  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    return Boolean(this.baseUrl());
  }

  async createCardSession(input: {
    sessionRef: string;
    returnUrl: string | null;
    pinfl: string | null;
  }): Promise<{ url: string }> {
    const response = await this.request('POST', '/card-sessions', input);
    const body = (await response.json().catch(() => null)) as {
      url?: unknown;
    } | null;
    const url = typeof body?.url === 'string' ? body.url : '';
    let parsed: URL | null = null;
    try {
      parsed = new URL(url);
    } catch {
      parsed = null;
    }
    // sotuvchi brauzeri shu manzilga boradi — faqat https (karta raqami kiritiladi)
    if (!parsed || parsed.protocol !== 'https:' || url.length > 2000)
      throw new PayoutRejectedError('provayder sahifa manzilini bermadi');
    return { url };
  }

  /** Bitta so‘rov — bitta chiqim (`payoutRef`). Noma’lum natijada `PayoutUnknownError` — qayta yuborilmaydi. */
  async send(input: {
    payoutRef: string;
    cardToken: string;
    amount: number;
    purpose: string;
  }): Promise<PayoutResult> {
    const response = await this.request('POST', '/payouts', {
      payoutRef: input.payoutRef,
      cardToken: input.cardToken,
      amount: input.amount,
      currency: 'UZS',
      purpose: input.purpose,
    });
    const result = await readResult(response);
    // 2xx, lekin holati tushunarsiz — natija noma’lum, holat keyin so‘raladi
    if (!result) throw new PayoutUnknownError('provayder javobida holat yo‘q');
    return result;
  }

  /** Holat; provayder bu chiqimni bilmasa — null. Har qanday xatoda `PayoutUnknownError`. */
  async status(payoutRef: string): Promise<PayoutResult | null> {
    let response: Response;
    try {
      response = await this.request(
        'GET',
        `/payouts/${encodeURIComponent(payoutRef)}`,
      );
    } catch (error) {
      if (error instanceof PayoutRejectedError && error.httpStatus === 404)
        return null;
      throw new PayoutUnknownError((error as Error).message);
    }
    const result = await readResult(response);
    if (!result) throw new PayoutUnknownError('provayder javobida holat yo‘q');
    return result;
  }

  private baseUrl(): string {
    return (this.config.get<string>('PAYOUT_API_URL') ?? '')
      .trim()
      .replace(/\/+$/, '');
  }

  private async request(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<Response> {
    const token = this.config.get<string>('PAYOUT_API_TOKEN')?.trim();
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl()}${path}`, {
        method,
        headers: {
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(PAYOUT_TIMEOUT_MS),
        redirect: 'error',
      });
    } catch (error) {
      const code = (error as { cause?: { code?: string } })?.cause?.code;
      if (code && NOT_CONNECTED.has(code))
        throw new PayoutRejectedError(`provayderga ulanib bo‘lmadi: ${code}`);
      throw new PayoutUnknownError(
        (error as Error)?.name === 'TimeoutError'
          ? `provayder ${PAYOUT_TIMEOUT_MS / 1000} soniyada javob bermadi`
          : `provayder bilan aloqa uzildi: ${(error as Error)?.message}`,
      );
    }
    // 5xx — provayder ichida nima bo‘lgani noma’lum; 4xx — aniq rad
    if (response.status >= 500)
      throw new PayoutUnknownError(`provayder HTTP ${response.status}`);
    if (!response.ok) {
      const reason = await reasonOf(response);
      throw new PayoutRejectedError(
        reason
          ? `provayder HTTP ${response.status}: ${reason}`
          : `provayder HTTP ${response.status}`,
        response.status,
      );
    }
    return response;
  }
}

async function readResult(response: Response): Promise<PayoutResult | null> {
  const body = (await response.json().catch(() => null)) as {
    status?: unknown;
    reason?: unknown;
  } | null;
  const status = typeof body?.status === 'string' ? body.status : '';
  if (!STATES.has(status)) return null;
  return {
    status: status as PayoutState,
    reason: typeof body?.reason === 'string' ? body.reason.slice(0, 300) : null,
  };
}

async function reasonOf(response: Response): Promise<string | null> {
  const body = (await response.json().catch(() => null)) as {
    reason?: unknown;
    message?: unknown;
  } | null;
  const reason = body?.reason ?? body?.message;
  return typeof reason === 'string' ? reason.slice(0, 300) : null;
}
