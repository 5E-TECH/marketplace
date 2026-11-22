import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@app/common';

/** T8: «admin va moliya uchun 2FA» — ADMIN, SUPERADMIN, FINANCE. */
export const TWO_FACTOR_ROLES: ReadonlySet<string> = new Set([
  Role.ADMIN,
  Role.SUPERADMIN,
  Role.FINANCE,
]);
const CHALLENGE_PURPOSE = 'staff-2fa';
/** Parol tasdig‘idan 2FA kodigacha [taklif]. */
const CHALLENGE_TTL = '5m';

export interface TwoFactorChallenge {
  /** 2FA ulangan — kod kerak. */
  twoFactorRequired: boolean;
  /** 2FA hali ulanmagan — avval ulash (QR) kerak. */
  twoFactorSetupRequired: boolean;
  /** Keyingi qadam uchun bir martalik token (sessiya emas). */
  challengeToken: string;
}

export interface ChallengeSubject {
  id: string;
  role: string;
  authVersion?: number | null;
  totpEnabledAt?: Date | null;
}

/**
 * BE-26: parol to‘g‘ri bo‘lgach xodimga sessiya o‘rniga 2FA bosqichi kerakmi. Bayroq `ADMIN_2FA=on` — FE-27
 * (login’da kod, QR bilan ulash) chiqquncha o‘chiq (karta), aks holda admin va moliya panelga kira olmaydi.
 * Token alohida sir bilan — kirish tokeni o‘rnida ishlatib bo‘lmaydi.
 */
@Injectable()
export class TwoFactorGate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  enabled(): boolean {
    return (
      (this.config.get<string>('ADMIN_2FA') ?? '').trim().toLowerCase() === 'on'
    );
  }

  required(user: ChallengeSubject): boolean {
    return this.enabled() && TWO_FACTOR_ROLES.has(user.role);
  }

  challenge(user: ChallengeSubject): TwoFactorChallenge {
    const enrolled = !!user.totpEnabledAt;
    return {
      twoFactorRequired: enrolled,
      twoFactorSetupRequired: !enrolled,
      challengeToken: this.jwt.sign(
        {
          sub: String(user.id),
          purpose: CHALLENGE_PURPOSE,
          av: user.authVersion ?? 1,
        },
        { secret: this.secret(), expiresIn: CHALLENGE_TTL },
      ),
    };
  }

  /** Token to‘g‘ri bo‘lsa — foydalanuvchi ID si va token paytidagi authVersion; aks holda null. */
  read(token: string): { userId: string; authVersion: number } | null {
    try {
      const payload = this.jwt.verify<{
        sub: string;
        purpose: string;
        av: number;
      }>(String(token ?? ''), { secret: this.secret() });
      if (payload.purpose !== CHALLENGE_PURPOSE) return null;
      return {
        userId: String(payload.sub),
        authVersion: Number(payload.av ?? 1),
      };
    } catch {
      return null;
    }
  }

  private secret(): string {
    return (
      this.config.get<string>('TWO_FACTOR_TOKEN_SECRET') ??
      `${this.config.getOrThrow<string>('JWT_SECRET')}:staff-2fa`
    );
  }
}
