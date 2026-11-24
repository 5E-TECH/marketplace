import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import {
  RecordingMode,
  SIGNED_LINK_TTL_SECONDS,
  SignedLinkDto,
} from '@app/common';

export interface RecordingTarget {
  callId: string;
  mode: RecordingMode;
  /** Havola kimga berilgan — ijro ham shu odam nomidan auditda. */
  userId: string;
}

export const RECORDINGS_PATH = 'call-recordings';

/**
 * BE-15 (TEL-7): yozuvni ijro etish havolasi — `<audio>` sarlavha yubora olmaydi, shuning uchun ruxsat va audit havola
 * berilganda tekshiriladi, havola esa vaqtli (BE-30 dagi imzolangan havola bilan bir xil muddat). Kalit BE-30 hujjat
 * havolasinikidan alohida — hujjat havolasi yozuvni ocholmaydi va aksincha.
 */
@Injectable()
export class RecordingLinkService {
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    const secret =
      config.get<string>('FILE_LINK_SECRET')?.trim() ||
      config.getOrThrow<string>('JWT_SECRET');
    this.key = createHmac('sha256', secret)
      .update('elchi:call-recording:v1')
      .digest();
  }

  sign(target: RecordingTarget, now = Date.now()): SignedLinkDto {
    const expiresAt = Math.floor(now / 1000) + SIGNED_LINK_TTL_SECONDS;
    const payload = Buffer.from(
      JSON.stringify({
        c: target.callId,
        u: target.userId,
        d: target.mode === RecordingMode.DOWNLOAD,
        e: expiresAt,
      }),
    ).toString('base64url');
    return {
      url: `/api/v1/${RECORDINGS_PATH}/${payload}.${this.mac(payload)}`,
      expiresAt: new Date(expiresAt * 1000).toISOString(),
    };
  }

  verify(token: string, now = Date.now()): RecordingTarget | null {
    const [payload, signature, extra] = String(token ?? '').split('.');
    if (!payload || !signature || extra !== undefined) return null;
    const expected = Buffer.from(this.mac(payload));
    const given = Buffer.from(signature);
    if (expected.length !== given.length || !timingSafeEqual(expected, given))
      return null;
    let data: { c?: unknown; u?: unknown; d?: unknown; e?: unknown };
    try {
      data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    } catch {
      return null;
    }
    if (typeof data.e !== 'number' || data.e * 1000 <= now) return null;
    if (typeof data.c !== 'string' || !/^\d+$/.test(data.c)) return null;
    if (typeof data.u !== 'string' || !/^\d+$/.test(data.u)) return null;
    return {
      callId: data.c,
      userId: data.u,
      mode: data.d === true ? RecordingMode.DOWNLOAD : RecordingMode.LISTEN,
    };
  }

  private mac(payload: string): string {
    return createHmac('sha256', this.key).update(payload).digest('base64url');
  }
}
