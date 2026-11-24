import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OperatorPhoneKind } from '@app/common';

/** TEL-2: tugmadan 3 soniyada qo‘ng‘iroq — provayder javobini shundan ortiq kutmaymiz. */
export const ORIGINATE_TIMEOUT_MS = 3_000;

export interface OriginateInput {
  callRef: string;
  operator: { kind: OperatorPhoneKind; value: string };
  /** Mijoz raqami — faqat provayderga, hech qachon brauzerga emas (T6). */
  customer: string;
  /** Mijozga ko‘rinadigan mahalliy raqam (TEL-1); null — provayder o‘zi tanlaydi. */
  callerId: string | null;
}

/** Natija noma’lum (vaqt tugadi, aloqa uzildi): qo‘ng‘iroq boshlangan bo‘lishi mumkin — FAILED deb yozilmaydi. */
export class TelephonyUnknownError extends Error {}

/** Provayder aniq rad etdi: qo‘ng‘iroq boshlanmadi. */
export class TelephonyRejectedError extends Error {}

/**
 * Telefoniya provayderi (EQ-02) — bitta joy: provayder tanlangach shu klass uning API siga yoziladi (yoki oraliq ko‘prik
 * quyidagi umumiy shaklni gapiradi). Hozirgi umumiy HTTP shakl (SMS adapteri kabi, BE-24):
 * - `POST {URL}/calls` `{callRef, operator:{kind,value}, customer, callerId, announceRecording}` → `{providerCallId}`:
 *   avval operator, u javob bergach mijoz; suhbat yoziladi, boshida «yozib olinadi» xabari (TEL-5);
 * - `POST {URL}/calls/{callRef}/hangup`;
 * - `GET {URL}/recordings/{recordingRef}` — audio (gateway o‘qiydi).
 * Hodisalar — `POST /webhooks/telephony` (gateway).
 */
@Injectable()
export class TelephonyProvider {
  private readonly logger = new Logger(TelephonyProvider.name);

  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    return Boolean(this.baseUrl());
  }

  callerId(): string | null {
    return this.config.get<string>('TELEPHONY_CALLER_ID')?.trim() || null;
  }

  async originate(
    input: OriginateInput,
  ): Promise<{ providerCallId: string | null }> {
    const response = await this.request('/calls', {
      callRef: input.callRef,
      operator: input.operator,
      customer: input.customer,
      callerId: input.callerId,
      announceRecording: true, // TEL-5
    });
    const body = (await response.json().catch(() => null)) as {
      providerCallId?: unknown;
    } | null;
    const id = body?.providerCallId;
    return {
      providerCallId:
        (typeof id === 'string' || typeof id === 'number') && String(id)
          ? String(id).slice(0, 200)
          : null,
    };
  }

  /** Tugatish; provayder javob bermasa — false (qo‘ng‘iroq o‘zi tugaydi, hodisa bilan bilinadi). */
  async hangup(callRef: string): Promise<boolean> {
    try {
      await this.request(`/calls/${encodeURIComponent(callRef)}/hangup`, {});
      return true;
    } catch (error) {
      this.logger.warn(
        `Qo‘ng‘iroqni tugatish so‘rovi o‘tmadi (${callRef}): ${(error as Error).message}`,
      );
      return false;
    }
  }

  private baseUrl(): string {
    return (this.config.get<string>('TELEPHONY_API_URL') ?? '')
      .trim()
      .replace(/\/+$/, '');
  }

  private async request(path: string, body: unknown): Promise<Response> {
    const token = this.config.get<string>('TELEPHONY_API_TOKEN')?.trim();
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl()}${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(ORIGINATE_TIMEOUT_MS),
        redirect: 'error',
      });
    } catch (error) {
      throw new TelephonyUnknownError(
        (error as Error)?.name === 'TimeoutError'
          ? 'provayder 3 soniyada javob bermadi'
          : `provayderga ulanib bo‘lmadi: ${(error as Error)?.message}`,
      );
    }
    // 5xx — provayder ichida nima bo‘lgani noma’lum; 4xx — aniq rad
    if (response.status >= 500)
      throw new TelephonyUnknownError(`provayder HTTP ${response.status}`);
    if (!response.ok)
      throw new TelephonyRejectedError(`provayder HTTP ${response.status}`);
    return response;
  }
}
