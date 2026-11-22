import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpStatus,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'crypto';
import { DataSource } from 'typeorm';
import {
  base32Encode,
  BusinessException,
  decryptSecret,
  encryptSecret,
  ErrorCode,
  generateTotpSecret,
  otpauthUrl,
  Role,
  verifyTotp,
} from '@app/common';
import { AuthService } from '../auth/auth.service';
import { User } from '../entities/user.entity';
import { TWO_FACTOR_ROLES, TwoFactorGate } from './two-factor.gate';

/** Xato kodlar: SMS kod qoidasi bilan bir xil — 3 xato → 15 daqiqa (TZ SOT-1 qiymatlari) [taklif]. */
const MAX_FAILED = 3;
const BLOCK_SECONDS = 900;
const RECOVERY_CODES = 8;

interface TotpRow {
  id: string;
  phone: string;
  role: string;
  authVersion: number;
  isBlocked: boolean;
  isActive: boolean;
  secretEnc: string | null;
  enabledAt: Date | null;
  lastStep: string | null;
  recovery: string[];
  failedCount: number;
  blockedUntil: Date | null;
}

const hash = (value: string) =>
  createHash('sha256')
    .update(value.replace(/[\s-]/g, '').toUpperCase())
    .digest('hex');

/**
 * BE-26 (T8: «admin va moliya uchun 2FA»): TOTP ulash, yoqish, kirishda tekshirish, tiklash kodlari va superadmin
 * tomonidan nolga tushirish. Hamma qadam parol bosqichidan keyingi `challengeToken` bilan (sessiya emas).
 */
@Injectable()
export class TwoFactorService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly gate: TwoFactorGate,
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  /** QR uchun sir va havola. Faqat 2FA hali yoqilmagan bo‘lsa (yoqilganini qayta ulash — superadmin nolga tushiradi). */
  async setup(
    challengeToken: string,
  ): Promise<{ secret: string; otpauthUrl: string }> {
    const user = await this.subject(challengeToken);
    if (user.enabledAt) throw new ConflictException('2FA allaqachon ulangan');
    const secret = generateTotpSecret();
    await this.dataSource.query(
      `UPDATE identity.users SET totp_secret_enc = $2, updated_at = now() WHERE id = $1`,
      [user.id, encryptSecret(secret, this.key())],
    );
    return { secret, otpauthUrl: otpauthUrl(secret, user.phone) };
  }

  /** Birinchi kod bilan yoqish → tiklash kodlari (faqat bir marta ko‘rsatiladi) va sessiya. */
  async enable(challengeToken: string, code: string) {
    const user = await this.subject(challengeToken);
    if (user.enabledAt) throw new ConflictException('2FA allaqachon ulangan');
    if (!user.secretEnc)
      throw new BadRequestException('Avval 2FA ni ulang (QR)');
    const step = await this.checkCode(user, code);
    const recoveryCodes = Array.from({ length: RECOVERY_CODES }, () =>
      base32Encode(randomBytes(6)).slice(0, 10),
    );
    await this.dataSource.query(
      `UPDATE identity.users
          SET totp_enabled_at = now(), totp_last_step = $2, totp_recovery = $3::jsonb,
              totp_failed_count = 0, totp_blocked_until = NULL, updated_at = now()
        WHERE id = $1`,
      [user.id, step, JSON.stringify(recoveryCodes.map(hash))],
    );
    return { recoveryCodes, ...(await this.session(user.id)) };
  }

  /** Kirish: TOTP kodi yoki bir martalik tiklash kodi → sessiya. */
  async verify(challengeToken: string, code?: string, recoveryCode?: string) {
    const user = await this.subject(challengeToken);
    if (!user.enabledAt || !user.secretEnc)
      throw new BadRequestException('2FA ulanmagan — avval ulang');
    this.assertNotBlocked(user);
    if (recoveryCode) {
      const h = hash(recoveryCode);
      const left = user.recovery.filter((r) => r !== h);
      if (left.length === user.recovery.length) {
        await this.fail(user);
        throw new UnauthorizedException('Tiklash kodi noto‘g‘ri');
      }
      await this.dataSource.query(
        `UPDATE identity.users SET totp_recovery = $2::jsonb, totp_failed_count = 0, updated_at = now() WHERE id = $1`,
        [user.id, JSON.stringify(left)],
      );
      return this.session(user.id);
    }
    const step = await this.checkCode(user, String(code ?? ''));
    // shu kodni bir vaqtda ikki so‘rov ishlata olmasin: oraliq faqat oldingisidan katta bo‘lsa yoziladi
    const claimed = (await this.dataSource.query(
      `UPDATE identity.users SET totp_last_step = $2, totp_failed_count = 0, updated_at = now()
        WHERE id = $1 AND (totp_last_step IS NULL OR totp_last_step < $2)
        RETURNING id`,
      [user.id, step],
    )) as unknown[] | [unknown[], number];
    if (
      !((Array.isArray(claimed[0]) ? claimed[0] : claimed) as unknown[]).length
    )
      throw new UnauthorizedException('2FA kodi allaqachon ishlatilgan');
    return this.session(user.id);
  }

  /** Superadmin xodimning 2FA sini nolga tushiradi (telefon va tiklash kodlari yo‘qolgan) — sessiyalar yopiladi. */
  async reset(actorId: string, userId: string): Promise<{ reset: true }> {
    const [actor] = (await this.dataSource.query(
      `SELECT role FROM identity.users WHERE id = $1 AND is_deleted = FALSE`,
      [actorId],
    )) as Array<{ role: string }>;
    if (actor?.role !== Role.SUPERADMIN)
      throw new ForbiddenException('2FA ni faqat superadmin nolga tushiradi');
    const rows = (await this.dataSource.query(
      `UPDATE identity.users
          SET totp_secret_enc = NULL, totp_enabled_at = NULL, totp_last_step = NULL, totp_recovery = '[]'::jsonb,
              totp_failed_count = 0, totp_blocked_until = NULL, auth_version = auth_version + 1, updated_at = now()
        WHERE id = $1 AND is_deleted = FALSE
        RETURNING id`,
      [userId],
    )) as unknown[] | [unknown[], number];
    const changed = (Array.isArray(rows[0]) ? rows[0] : rows) as unknown[];
    if (!changed.length) throw new NotFoundException('Foydalanuvchi topilmadi');
    await this.auth.logout(String(userId));
    return { reset: true };
  }

  // ------------------------------------------------------------------

  private async subject(challengeToken: string): Promise<TotpRow> {
    const claim = this.gate.read(challengeToken);
    if (!claim)
      throw new UnauthorizedException(
        '2FA bosqichi muddati o‘tdi — qayta kiring',
      );
    const [row] = (await this.dataSource.query(
      `SELECT id::text, phone, role, auth_version AS "authVersion", is_blocked AS "isBlocked",
              is_active AS "isActive", totp_secret_enc AS "secretEnc", totp_enabled_at AS "enabledAt",
              totp_last_step::text AS "lastStep", totp_recovery AS recovery,
              totp_failed_count AS "failedCount", totp_blocked_until AS "blockedUntil"
         FROM identity.users WHERE id = $1 AND is_deleted = FALSE`,
      [claim.userId],
    )) as TotpRow[];
    // parol bosqichidan keyin bloklangan, roli o‘zgargan yoki sessiyalari bekor qilingan — token yaroqsiz
    if (
      !row ||
      row.isBlocked ||
      !TWO_FACTOR_ROLES.has(row.role) ||
      Number(row.authVersion ?? 1) !== claim.authVersion
    )
      throw new UnauthorizedException(
        '2FA bosqichi muddati o‘tdi — qayta kiring',
      );
    return {
      ...row,
      recovery: Array.isArray(row.recovery) ? row.recovery : [],
    };
  }

  /** TOTP kodi: blok, qayta ishlatish (shu yoki eski oraliq) va xato hisobi bilan. Qaytaradi: oraliq raqami. */
  private async checkCode(user: TotpRow, code: string): Promise<number> {
    this.assertNotBlocked(user);
    const step = verifyTotp(decryptSecret(user.secretEnc!, this.key()), code);
    if (
      step === null ||
      (user.lastStep !== null && step <= Number(user.lastStep))
    ) {
      await this.fail(user);
      throw new UnauthorizedException('2FA kodi noto‘g‘ri');
    }
    return step;
  }

  private assertNotBlocked(user: TotpRow): void {
    const until = user.blockedUntil ? new Date(user.blockedUntil).getTime() : 0;
    if (until > Date.now())
      throw new BusinessException(
        `3 marta noto‘g‘ri 2FA kodi — ${Math.ceil((until - Date.now()) / 60_000)} daqiqadan keyin qayta urining`,
        ErrorCode.RATE_LIMITED,
        HttpStatus.LOCKED,
      );
  }

  private async fail(user: TotpRow): Promise<void> {
    await this.dataSource.query(
      `UPDATE identity.users
          SET totp_failed_count = CASE WHEN totp_failed_count + 1 >= $2 THEN 0 ELSE totp_failed_count + 1 END,
              totp_blocked_until = CASE WHEN totp_failed_count + 1 >= $2
                                        THEN now() + make_interval(secs => $3) ELSE totp_blocked_until END,
              updated_at = now()
        WHERE id = $1`,
      [user.id, MAX_FAILED, BLOCK_SECONDS],
    );
  }

  private async session(userId: string) {
    const user = await this.dataSource
      .getRepository(User)
      .findOneByOrFail({ id: userId });
    if (!user.isActive || user.isBlocked)
      throw new UnauthorizedException('Hisob faol emas');
    return this.auth.buildAuthResult(user);
  }

  /** TOTP sirlari kaliti — alohida sir (JWT sirlari almashtirilsa ham 2FA buzilmasin). */
  private key(): string {
    return this.config.getOrThrow<string>('TWO_FACTOR_SECRET_KEY');
  }
}
