import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomInt, randomUUID } from 'crypto';
import { EntityManager } from 'typeorm';
import {
  BusinessException,
  ErrorCode,
  OTP_BLOCK_SECONDS,
  OTP_MAX_FAILED,
  OTP_TTL_SECONDS,
} from '@app/common';

export type OtpCheck =
  | { kind: 'ok' }
  | { kind: 'expired' }
  | { kind: 'invalid'; attemptsLeft: number }
  | { kind: 'blocked' };

/**
 * BE-06 (TZ SOT-1, T9-9): hamma SMS kodlar uchun yagona qoida — sotuvchi ro‘yxati va kirishi, parolni tiklash,
 * telefonni tasdiqlash. Kod `crypto.randomInt`, bazada server siri bilan HMAC (bazani o‘qigan odam 6 raqamni
 * tiklay olmasin); 5 daqiqa; telefon va maqsad bo‘yicha 3 xato → 15 daqiqa blok. Xatolar oxirgisidan 15 daqiqa
 * o‘tsa hisob nolga tushadi [taklif]. Hamma amal chaqiruvchi tranzaksiyasida, holat qatori qulf bilan.
 */
@Injectable()
export class OtpGuardService {
  constructor(private readonly config: ConfigService) {}

  hash(code: string): string {
    const secret =
      this.config.get<string>('OTP_HASH_SECRET') ??
      `${this.config.getOrThrow<string>('JWT_SECRET')}:otp`;
    return createHmac('sha256', secret).update(code).digest('hex');
  }

  /** Yangi kod: eskisi bekor, xato hisobi saqlanadi. Blokda — 423. */
  async issue(
    m: EntityManager,
    phone: string,
    purpose: string,
  ): Promise<string> {
    await this.lock(m, phone, purpose);
    const code = String(randomInt(100_000, 1_000_000));
    await m.query(
      `UPDATE identity.verification_code SET used_at = now()
        WHERE phone = $1 AND purpose = $2 AND used_at IS NULL`,
      [phone, purpose],
    );
    await m.query(
      `INSERT INTO identity.verification_code(id, phone, purpose, code_hash, expires_at)
       VALUES ($1, $2, $3, $4, now() + make_interval(secs => $5))`,
      [randomUUID(), phone, purpose, this.hash(code), OTP_TTL_SECONDS],
    );
    // eski, bloksiz holat qatorlari tozalanadi (jadval cheksiz o‘smasin)
    await m.query(
      `DELETE FROM identity.otp_state
        WHERE updated_at < now() - interval '1 day'
          AND (blocked_until IS NULL OR blocked_until < now())`,
    );
    return code;
  }

  /** Kodni tekshiradi va natijani yozadi (xato hisobi, blok, kod ishlatildi). Blokda — 423 tashlanadi. */
  async check(
    m: EntityManager,
    phone: string,
    purpose: string,
    code: string,
  ): Promise<OtpCheck> {
    const failed = await this.lock(m, phone, purpose);
    const [current] = (await m.query(
      `SELECT id, code_hash AS "codeHash" FROM identity.verification_code
        WHERE phone = $1 AND purpose = $2 AND used_at IS NULL AND expires_at > now()
        ORDER BY created_at DESC LIMIT 1`,
      [phone, purpose],
    )) as Array<{ id: string; codeHash: string }>;
    if (!current) return { kind: 'expired' };
    if (current.codeHash !== this.hash(String(code ?? ''))) {
      const count = failed + 1;
      if (count >= OTP_MAX_FAILED) {
        await m.query(
          `UPDATE identity.otp_state
              SET failed_count = 0, blocked_until = now() + make_interval(secs => $3), updated_at = now()
            WHERE phone = $1 AND purpose = $2`,
          [phone, purpose, OTP_BLOCK_SECONDS],
        );
        await m.query(
          `UPDATE identity.verification_code SET used_at = now() WHERE id = $1`,
          [current.id],
        );
        return { kind: 'blocked' };
      }
      await m.query(
        `UPDATE identity.otp_state SET failed_count = $3, updated_at = now()
          WHERE phone = $1 AND purpose = $2`,
        [phone, purpose, count],
      );
      return { kind: 'invalid', attemptsLeft: OTP_MAX_FAILED - count };
    }
    await m.query(
      `UPDATE identity.verification_code SET used_at = now() WHERE id = $1`,
      [current.id],
    );
    await m.query(
      `UPDATE identity.otp_state SET failed_count = 0, blocked_until = NULL, updated_at = now()
        WHERE phone = $1 AND purpose = $2`,
      [phone, purpose],
    );
    return { kind: 'ok' };
  }

  /** Tekshiruv natijasi → xato (muvaffaqiyatda hech narsa). */
  throwUnlessOk(result: OtpCheck): void {
    if (result.kind === 'expired')
      throw new BusinessException(
        'Kod muddati o‘tgan yoki so‘ralmagan — yangi kod so‘rang',
        ErrorCode.OTP_EXPIRED,
        HttpStatus.GONE,
      );
    if (result.kind === 'blocked') throw this.blockedError(OTP_BLOCK_SECONDS);
    if (result.kind === 'invalid')
      throw new BusinessException(
        'Kod noto‘g‘ri',
        ErrorCode.OTP_INVALID,
        HttpStatus.BAD_REQUEST,
        {
          attemptsLeft: result.attemptsLeft,
        },
      );
  }

  /** Holat qatori qulf bilan; blokda — 423. Qaytaradi: amaldagi xato soni (eskirgani — 0). */
  private async lock(
    m: EntityManager,
    phone: string,
    purpose: string,
  ): Promise<number> {
    await m.query(
      `INSERT INTO identity.otp_state (phone, purpose) VALUES ($1, $2)
       ON CONFLICT (phone, purpose) DO NOTHING`,
      [phone, purpose],
    );
    const [row] = (await m.query(
      `SELECT failed_count AS "failedCount", blocked_until AS "blockedUntil",
              updated_at < now() - make_interval(secs => $3) AS stale
         FROM identity.otp_state WHERE phone = $1 AND purpose = $2 FOR UPDATE`,
      [phone, purpose, OTP_BLOCK_SECONDS],
    )) as Array<{
      failedCount: number;
      blockedUntil: Date | null;
      stale: boolean;
    }>;
    const until = row.blockedUntil ? new Date(row.blockedUntil).getTime() : 0;
    if (until > Date.now())
      throw this.blockedError(Math.ceil((until - Date.now()) / 1000));
    return row.stale ? 0 : Number(row.failedCount);
  }

  blockedError(retryAfterSeconds: number): BusinessException {
    return new BusinessException(
      '3 marta noto‘g‘ri kod — 15 daqiqadan keyin qayta urining',
      ErrorCode.OTP_BLOCKED,
      HttpStatus.LOCKED,
      { retryAfterSeconds },
    );
  }
}
