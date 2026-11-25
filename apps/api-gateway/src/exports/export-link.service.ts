import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import { SIGNED_LINK_TTL_SECONDS } from '@app/common';

export type ExportKind = 'leads' | 'orders';

/** Nima eksport qilinadi: kim so‘ragan, filtr, ustunlar va so‘ralgan vaqt (undan keyingi qator kirmaydi). */
export interface ExportTicket {
  kind: ExportKind;
  userId: string;
  filters: Record<string, unknown>;
  columns: string[];
  until: string;
}

/**
 * BE-25 (FE-26 «CSV eksport»): fayl saqlanmaydi — chipta (filtr va ustunlar) imzolanadi, CSV yuklab olishda tuziladi.
 * Shaxsiy ma’lumotli fayl serverda qolmaydi. Muddat — boshqa imzolangan havolalar bilan bir xil; chiptani faqat so‘ragan
 * admin o‘zi ishlatadi. Kalit boshqa havolalarnikidan alohida.
 */
@Injectable()
export class ExportLinkService {
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    const secret =
      config.get<string>('FILE_LINK_SECRET')?.trim() ||
      config.getOrThrow<string>('JWT_SECRET');
    this.key = createHmac('sha256', secret)
      .update('elchi:csv-export:v1')
      .digest();
  }

  sign(
    ticket: ExportTicket,
    now = Date.now(),
  ): { id: string; expiresAt: string } {
    const expiresAt = Math.floor(now / 1000) + SIGNED_LINK_TTL_SECONDS;
    const payload = Buffer.from(
      JSON.stringify({ ...ticket, e: expiresAt }),
    ).toString('base64url');
    return {
      id: `${payload}.${this.mac(payload)}`,
      expiresAt: new Date(expiresAt * 1000).toISOString(),
    };
  }

  verify(
    token: string,
    kind: ExportKind,
    userId: string,
    now = Date.now(),
  ): ExportTicket | null {
    const [payload, signature, extra] = String(token ?? '').split('.');
    if (!payload || !signature || extra !== undefined) return null;
    const expected = Buffer.from(this.mac(payload));
    const given = Buffer.from(signature);
    if (expected.length !== given.length || !timingSafeEqual(expected, given))
      return null;
    let data: ExportTicket & { e?: unknown };
    try {
      data = JSON.parse(
        Buffer.from(payload, 'base64url').toString('utf8'),
      ) as ExportTicket & { e?: unknown };
    } catch {
      return null;
    }
    if (typeof data.e !== 'number' || data.e * 1000 <= now) return null;
    if (data.kind !== kind || data.userId !== String(userId)) return null;
    return {
      kind: data.kind,
      userId: data.userId,
      filters: data.filters ?? {},
      columns: data.columns ?? [],
      until: data.until,
    };
  }

  private mac(payload: string): string {
    return createHmac('sha256', this.key).update(payload).digest('base64url');
  }
}
