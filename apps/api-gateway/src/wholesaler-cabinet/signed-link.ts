import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import { SIGNED_LINK_TTL_SECONDS, SignedLinkDto } from '@app/common';

/** Imzolangan havola nimani ochadi: optovik hujjati, elektron shartnoma PDF i yoki qaytarish so‘rovi rasmi. */
export type SignedTarget =
  | { t: 'doc'; id: string }
  | { t: 'contract'; w: string }
  | { t: 'return-photo'; id: string };

export const SIGNED_FILES_PATH = 'signed-files';

/**
 * BE-30 (TC4): yopiq hujjatga vaqtli havola — `signed-files/<payload>.<imzo>`, HMAC-SHA256, muddati 10 daqiqa
 * [taklif]. Imzosiz, buzilgan yoki muddati o‘tgan — null (controller 403 beradi). MinIO presigned GET ishlatilmaydi:
 * prod `/media` proksisi yo‘lni o‘zgartiradi va imzo buziladi (BE-08). Kalit — `FILE_LINK_SECRET`, berilmasa
 * `JWT_SECRET` dan alohida maqsad bilan olinadi (token imzosi bilan bir xil emas).
 */
@Injectable()
export class SignedLinkService {
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    const own = config.get<string>('FILE_LINK_SECRET')?.trim();
    this.key = own
      ? Buffer.from(own)
      : createHmac('sha256', config.getOrThrow<string>('JWT_SECRET'))
          .update('elchi:file-link:v1')
          .digest();
  }

  sign(target: SignedTarget, now = Date.now()): SignedLinkDto {
    const expiresAt = Math.floor(now / 1000) + SIGNED_LINK_TTL_SECONDS;
    const payload = Buffer.from(
      JSON.stringify({ ...target, e: expiresAt }),
    ).toString('base64url');
    return {
      url: `/api/v1/${SIGNED_FILES_PATH}/${payload}.${this.mac(payload)}`,
      expiresAt: new Date(expiresAt * 1000).toISOString(),
    };
  }

  verify(token: string, now = Date.now()): SignedTarget | null {
    const [payload, signature, extra] = String(token ?? '').split('.');
    if (!payload || !signature || extra !== undefined) return null;
    const expected = Buffer.from(this.mac(payload));
    const given = Buffer.from(signature);
    if (expected.length !== given.length || !timingSafeEqual(expected, given))
      return null;
    let data: { t?: unknown; id?: unknown; w?: unknown; e?: unknown };
    try {
      data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    } catch {
      return null;
    }
    if (typeof data.e !== 'number' || data.e * 1000 <= now) return null;
    if (
      (data.t === 'doc' || data.t === 'return-photo') &&
      typeof data.id === 'string' &&
      /^\d+$/.test(data.id)
    )
      return { t: data.t, id: data.id };
    if (
      data.t === 'contract' &&
      typeof data.w === 'string' &&
      /^\d+$/.test(data.w)
    )
      return { t: 'contract', w: data.w };
    return null;
  }

  private mac(payload: string): string {
    return createHmac('sha256', this.key).update(payload).digest('base64url');
  }
}
