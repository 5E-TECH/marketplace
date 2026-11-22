import {
  BadRequestException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ClientProxy } from '@nestjs/microservices';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes, randomInt, randomUUID } from 'crypto';
import { DataSource, EntityManager, Repository } from 'typeorm';
import {
  AcceptAgreementDto,
  AffiliateProfileDto,
  BusinessException,
  ErrorCode,
  LegalDocumentDto,
  LegalDocumentType,
  OTP_BLOCK_SECONDS,
  OTP_MAX_FAILED,
  OTP_TTL_SECONDS,
  OtpPurpose,
  OtpSendResultDto,
  PublishLegalDocumentDto,
  RegisterAffiliateDto,
  RmqClient,
  Role,
  SendOtpDto,
  UpdateAffiliateProfileDto,
  VerifyOtpDto,
} from '@app/common';
import { User } from '../entities/user.entity';
import { AuthService } from '../auth/auth.service';

/** SMS kod bilan kira oladigan rollar (FE-04: «sotuvchi va optovik kirishi»); xodim parol bilan kiradi. */
const OTP_LOGIN_ROLES: ReadonlySet<Role> = new Set([
  Role.AFFILIATE,
  Role.WHOLESALER,
]);
/** Ro‘yxat tokeni: kod tasdiqlangandan oferta qadamigacha [taklif, BE-06 savol 3]. */
const REGISTRATION_TOKEN_TTL = '30m';
const REGISTRATION_PURPOSE = 'affiliate-registration';
const BCRYPT_ROUNDS = 10;

const hash = (value: string) =>
  createHash('sha256').update(value).digest('hex');

interface OtpState {
  failedCount: number;
  blockedUntil: Date | null;
}

/**
 * BE-06 (TZ 6.1 SOT-1, T9-9): sotuvchi telefon va SMS kod bilan ro‘yxatdan o‘tadi va kiradi, ofertani qabul qiladi.
 * Kod `crypto.randomInt`, bazada faqat xeshi; 5 daqiqa amal qiladi; telefon va maqsad bo‘yicha 3 xato → 15 daqiqa
 * blok (hisob yangi kod so‘ralganda ham saqlanadi). Kod notification-service ga hodisa bilan ketadi (SMS — BE-24).
 */
@Injectable()
export class AffiliateAuthService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly auth: AuthService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly dataSource: DataSource,
    @Inject(RmqClient.NOTIFICATION)
    private readonly notifications: ClientProxy,
  ) {}

  // ------------------------------------------------------------------ SMS kod

  async sendOtp(dto: SendOtpDto): Promise<OtpSendResultDto> {
    const phone = String(dto?.phone ?? '');
    const purpose = this.purposeOf(dto?.purpose);
    if (!this.operatorAllowed(phone))
      throw new BusinessException(
        'Raqam O‘zbekiston mobil operatoriniki emas',
        ErrorCode.PHONE_OPERATOR_INVALID,
        HttpStatus.BAD_REQUEST,
      );
    const user = await this.users.findOne({
      where: { phone, isDeleted: false },
    });
    if (purpose === OtpPurpose.REGISTER && user)
      throw new BusinessException(
        'Bu raqam allaqachon ro‘yxatdan o‘tgan',
        ErrorCode.PHONE_ALREADY_REGISTERED,
        HttpStatus.CONFLICT,
      );
    if (
      purpose === OtpPurpose.LOGIN &&
      (!user || !OTP_LOGIN_ROLES.has(user.role) || user.isBlocked)
    )
      throw new BusinessException(
        'Bu raqam bilan sotuvchi hisobi topilmadi',
        ErrorCode.ACCOUNT_NOT_FOUND,
        HttpStatus.NOT_FOUND,
      );

    const code = String(randomInt(100_000, 1_000_000));
    await this.dataSource.transaction(async (m) => {
      const state = await this.lockState(m, phone, purpose);
      this.assertNotBlocked(state);
      // yangi kod eskisini bekor qiladi; xato hisobi saqlanadi (FE-04)
      await m.query(
        `UPDATE identity.verification_code SET used_at = now()
          WHERE phone = $1 AND purpose = $2 AND used_at IS NULL`,
        [phone, purpose],
      );
      await m.query(
        `INSERT INTO identity.verification_code(id, phone, purpose, code_hash, expires_at)
         VALUES ($1, $2, $3, $4, now() + make_interval(secs => $5))`,
        [randomUUID(), phone, purpose, hash(code), OTP_TTL_SECONDS],
      );
    });
    // notification-service SMS adapteri orqali yuboradi (sozlanmagan bo‘lsa — test stub, kod logda)
    this.notifications.emit('auth.verification-code.requested', {
      phone,
      code,
      purpose,
    });
    return { expiresIn: OTP_TTL_SECONDS, delivery: 'SENT' };
  }

  async verifyOtp(
    dto: VerifyOtpDto,
  ): Promise<
    | { registrationToken: string }
    | Awaited<ReturnType<AuthService['buildAuthResult']>>
  > {
    const phone = String(dto?.phone ?? '');
    const purpose = this.purposeOf(dto?.purpose);
    const code = String(dto?.code ?? '');
    const outcome = await this.dataSource.transaction(async (m) => {
      const state = await this.lockState(m, phone, purpose);
      this.assertNotBlocked(state);
      const [current] = (await m.query(
        `SELECT id, code_hash AS "codeHash" FROM identity.verification_code
          WHERE phone = $1 AND purpose = $2 AND used_at IS NULL AND expires_at > now()
          ORDER BY created_at DESC LIMIT 1`,
        [phone, purpose],
      )) as Array<{ id: string; codeHash: string }>;
      if (!current) return { kind: 'expired' as const };
      if (current.codeHash !== hash(code)) {
        const failed = state.failedCount + 1;
        if (failed >= OTP_MAX_FAILED) {
          // 3-xato: blok; kod bekor (blokdan keyin yangisini so‘raydi)
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
          return { kind: 'blocked' as const };
        }
        await m.query(
          `UPDATE identity.otp_state SET failed_count = $3, updated_at = now()
            WHERE phone = $1 AND purpose = $2`,
          [phone, purpose, failed],
        );
        return {
          kind: 'invalid' as const,
          attemptsLeft: OTP_MAX_FAILED - failed,
        };
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
      return { kind: 'ok' as const, codeId: current.id };
    });

    // tranzaksiya tugagach: xato hisobi va blok saqlangan bo‘lsin, keyin xato qaytadi
    if (outcome.kind === 'expired')
      throw new BusinessException(
        'Kod muddati o‘tgan yoki so‘ralmagan — yangi kod so‘rang',
        ErrorCode.OTP_EXPIRED,
        HttpStatus.GONE,
      );
    if (outcome.kind === 'blocked') throw this.blockedError(OTP_BLOCK_SECONDS);
    if (outcome.kind === 'invalid')
      throw new BusinessException(
        'Kod noto‘g‘ri',
        ErrorCode.OTP_INVALID,
        HttpStatus.BAD_REQUEST,
        { attemptsLeft: outcome.attemptsLeft },
      );

    if (purpose === OtpPurpose.REGISTER) {
      const registrationToken = this.jwt.sign(
        { sub: phone, purpose: REGISTRATION_PURPOSE, jti: outcome.codeId },
        {
          expiresIn: REGISTRATION_TOKEN_TTL,
          secret: this.registrationSecret(),
        },
      );
      return { registrationToken };
    }
    const user = await this.users.findOne({
      where: { phone, isDeleted: false },
    });
    if (
      !user ||
      !OTP_LOGIN_ROLES.has(user.role) ||
      user.isBlocked ||
      !user.isActive
    )
      throw new UnauthorizedException('Hisob faol emas');
    return this.auth.buildAuthResult(user);
  }

  // ------------------------------------------------------------------ ro‘yxat

  async registerAffiliate(
    dto: RegisterAffiliateDto,
    ip: string | null,
  ): Promise<Awaited<ReturnType<AuthService['buildAuthResult']>>> {
    let phone: string;
    try {
      const payload = this.jwt.verify<{ sub: string; purpose: string }>(
        String(dto?.registrationToken ?? ''),
        { secret: this.registrationSecret() },
      );
      if (payload.purpose !== REGISTRATION_PURPOSE) throw new Error('purpose');
      phone = String(payload.sub);
    } catch {
      throw new BusinessException(
        'Ro‘yxat muddati o‘tdi — telefonni qayta tasdiqlang',
        ErrorCode.REGISTRATION_EXPIRED,
        HttpStatus.GONE,
      );
    }
    const offer = await this.currentDocument(LegalDocumentType.AFFILIATE_OFFER);
    const consent = await this.currentDocument(
      LegalDocumentType.PERSONAL_DATA_CONSENT,
    );
    // «Oferta qabul qilinmasa ro‘yxat tugamaydi» — versiya joriy hujjatga teng bo‘lishi shart
    if (
      !offer ||
      !consent ||
      dto?.offerVersion !== offer.version ||
      dto?.consentVersion !== consent.version
    )
      throw new BusinessException(
        'Sotuvchi ofertasi va rozilikning joriy versiyasini qabul qiling',
        ErrorCode.OFFER_NOT_ACCEPTED,
        HttpStatus.BAD_REQUEST,
      );

    const user = await this.dataSource.transaction(async (m) => {
      const exists = await m.getRepository(User).findOne({ where: { phone } });
      // token bir martalik: shu raqam bilan hisob yaratilgan bo‘lsa — qayta ishlatib bo‘lmaydi
      if (exists)
        throw new BusinessException(
          'Bu raqam allaqachon ro‘yxatdan o‘tgan',
          ErrorCode.PHONE_ALREADY_REGISTERED,
          HttpStatus.CONFLICT,
        );
      const created = await m.getRepository(User).save(
        m.getRepository(User).create({
          name: '',
          phone,
          email: null,
          // parol yo‘q — kirish SMS kod bilan; tasodifiy xesh parol bilan kirishni yopadi
          passwordHash: await bcrypt.hash(
            randomBytes(32).toString('hex'),
            BCRYPT_ROUNDS,
          ),
          role: Role.AFFILIATE,
          isActive: true,
        }),
      );
      await m.query(
        `UPDATE identity.users SET phone_verified_at = now() WHERE id = $1`,
        [created.id],
      );
      for (const doc of [offer, consent])
        await m.query(
          `INSERT INTO identity.user_agreement (user_id, type, version, ip) VALUES ($1, $2, $3, $4)`,
          [created.id, doc.type, doc.version, ip],
        );
      return created;
    });
    return this.auth.buildAuthResult(user);
  }

  // ------------------------------------------------------------------ hujjatlar

  async legalDocument(type: string): Promise<LegalDocumentDto> {
    const doc = await this.currentDocument(this.documentType(type));
    if (!doc) throw new NotFoundException('Hujjat topilmadi');
    return doc;
  }

  async publishLegalDocument(
    type: string,
    dto: PublishLegalDocumentDto,
    actorId: string,
  ): Promise<LegalDocumentDto> {
    const docType = this.documentType(type);
    const rows = (await this.dataSource.query(
      `INSERT INTO identity.legal_document (type, version, effective_at, summary, sections, created_by)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6)
       ON CONFLICT (type, version) DO NOTHING
       RETURNING id`,
      [
        docType,
        dto.version,
        dto.effectiveAt ? new Date(dto.effectiveAt) : null,
        JSON.stringify(dto.summary ?? []),
        JSON.stringify(dto.sections ?? []),
        actorId,
      ],
    )) as Array<{ id: string }>;
    if (!rows.length)
      throw BusinessException.conflict('Bu versiya allaqachon e’lon qilingan');
    return (await this.currentDocument(docType))!;
  }

  // ------------------------------------------------------------------ profil

  async profile(userId: string): Promise<AffiliateProfileDto> {
    const user = await this.affiliate(userId);
    const [login] = (await this.dataSource.query(
      `SELECT max(created_at) AS at FROM identity.auth_session WHERE user_id = $1`,
      [user.id],
    )) as Array<{ at: Date | null }>;
    const rows = (await this.dataSource.query(
      `SELECT type, version, accepted_at AS "acceptedAt",
              row_number() OVER (PARTITION BY type ORDER BY accepted_at DESC, id DESC) = 1 AS current
         FROM identity.user_agreement WHERE user_id = $1
        ORDER BY accepted_at DESC, id DESC`,
      [user.id],
    )) as Array<{
      type: LegalDocumentType;
      version: string;
      acceptedAt: Date;
      current: boolean;
    }>;
    return {
      id: String(user.id),
      firstName: user.firstName ?? '',
      lastName: user.lastName ?? '',
      phone: user.phone,
      registeredAt: new Date(user.createdAt).toISOString(),
      lastLoginAt: login?.at ? new Date(login.at).toISOString() : null,
      agreements: rows.map((r) => ({
        type: r.type,
        version: r.version,
        acceptedAt: new Date(r.acceptedAt).toISOString(),
        current: r.current,
      })),
    };
  }

  async updateProfile(
    userId: string,
    dto: UpdateAffiliateProfileDto,
  ): Promise<AffiliateProfileDto> {
    const user = await this.affiliate(userId);
    const firstName = String(dto?.firstName ?? '').trim();
    const lastName = String(dto?.lastName ?? '').trim();
    if (!firstName || !lastName)
      throw new BadRequestException('Ism va familiya majburiy');
    user.firstName = firstName;
    user.lastName = lastName;
    user.name = `${firstName} ${lastName}`.slice(0, 255);
    await this.users.save(user);
    return this.profile(userId);
  }

  async acceptAgreement(
    userId: string,
    dto: AcceptAgreementDto,
    ip: string | null,
  ): Promise<AffiliateProfileDto> {
    const user = await this.affiliate(userId);
    const doc = await this.currentDocument(this.documentType(dto?.type));
    // faqat joriy versiyani qabul qilish mumkin (eskisini yoki hali yo‘g‘ini emas)
    if (!doc || dto?.version !== doc.version)
      throw new BusinessException(
        'Hujjatning joriy versiyasini qabul qiling',
        ErrorCode.OFFER_NOT_ACCEPTED,
        HttpStatus.BAD_REQUEST,
      );
    await this.dataSource.query(
      `INSERT INTO identity.user_agreement (user_id, type, version, ip) VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, type, version) DO NOTHING`,
      [user.id, doc.type, doc.version, ip],
    );
    return this.profile(userId);
  }

  // ------------------------------------------------------------------ yordamchilar

  /**
   * Ro‘yxat tokeni kirish tokenidan boshqa sir bilan imzolanadi — gateway uni hech qachon kirish tokeni deb qabul
   * qilmasin (`JWT_SECRET` bilan tekshiradi). `JWT_REGISTRATION_SECRET` berilmasa — `JWT_SECRET` dan hosil qilinadi.
   */
  private registrationSecret(): string {
    return (
      this.config.get<string>('JWT_REGISTRATION_SECRET') ??
      `${this.config.getOrThrow<string>('JWT_SECRET')}:affiliate-registration`
    );
  }

  private purposeOf(value: unknown): OtpPurpose {
    if (value === OtpPurpose.REGISTER || value === OtpPurpose.LOGIN)
      return value;
    throw new BadRequestException('purpose: REGISTER yoki LOGIN');
  }

  private documentType(value: unknown): LegalDocumentType {
    if (
      value === LegalDocumentType.AFFILIATE_OFFER ||
      value === LegalDocumentType.PERSONAL_DATA_CONSENT
    )
      return value;
    throw new NotFoundException('Hujjat topilmadi');
  }

  /** Lid qoidasi bilan bir xil ro‘yxat (`LEAD_PHONE_OPERATOR_CODES`, LID-2); berilmasa faqat format. */
  private operatorAllowed(phone: string): boolean {
    if (!/^\+998\d{9}$/.test(phone)) return false;
    const codes = (this.config.get<string>('LEAD_PHONE_OPERATOR_CODES') ?? '')
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean);
    return !codes.length || codes.includes(phone.slice(4, 6));
  }

  /** Holat qatori (bo‘lmasa yaratiladi) qulf bilan — bir telefonga parallel so‘rovlar hisobni buzmasin. */
  private async lockState(
    m: EntityManager,
    phone: string,
    purpose: OtpPurpose,
  ): Promise<OtpState> {
    await m.query(
      `INSERT INTO identity.otp_state (phone, purpose) VALUES ($1, $2)
       ON CONFLICT (phone, purpose) DO NOTHING`,
      [phone, purpose],
    );
    const [row] = (await m.query(
      `SELECT failed_count AS "failedCount", blocked_until AS "blockedUntil"
         FROM identity.otp_state WHERE phone = $1 AND purpose = $2 FOR UPDATE`,
      [phone, purpose],
    )) as Array<{ failedCount: number; blockedUntil: Date | null }>;
    return {
      failedCount: Number(row.failedCount),
      blockedUntil: row.blockedUntil,
    };
  }

  private assertNotBlocked(state: OtpState): void {
    const until = state.blockedUntil
      ? new Date(state.blockedUntil).getTime()
      : 0;
    if (until > Date.now())
      throw this.blockedError(Math.ceil((until - Date.now()) / 1000));
  }

  private blockedError(retryAfterSeconds: number): BusinessException {
    return new BusinessException(
      '3 marta noto‘g‘ri kod — 15 daqiqadan keyin qayta urining',
      ErrorCode.OTP_BLOCKED,
      HttpStatus.LOCKED,
      { retryAfterSeconds },
    );
  }

  private async currentDocument(
    type: LegalDocumentType,
  ): Promise<LegalDocumentDto | null> {
    const [row] = (await this.dataSource.query(
      `SELECT type, version, effective_at AS "effectiveAt", summary, sections
         FROM identity.legal_document
        WHERE type = $1 AND (effective_at IS NULL OR effective_at <= now())
        ORDER BY created_at DESC, id DESC LIMIT 1`,
      [type],
    )) as Array<{
      type: LegalDocumentType;
      version: string;
      effectiveAt: Date | null;
      summary: LegalDocumentDto['summary'];
      sections: LegalDocumentDto['sections'];
    }>;
    if (!row) return null;
    return {
      type: row.type,
      version: row.version,
      effectiveAt: row.effectiveAt
        ? new Date(row.effectiveAt).toISOString()
        : null,
      summary: row.summary ?? [],
      sections: row.sections ?? [],
    };
  }

  private async affiliate(userId: string): Promise<User> {
    const user = await this.users.findOne({
      where: { id: String(userId), isDeleted: false },
    });
    if (!user || user.role !== Role.AFFILIATE)
      throw new NotFoundException('Sotuvchi topilmadi');
    return user;
  }
}
