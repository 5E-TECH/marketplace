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
import { randomBytes, randomUUID } from 'crypto';
import { DataSource, Repository } from 'typeorm';
import {
  AcceptAgreementDto,
  AffiliateProfileDto,
  BusinessException,
  EnsureWholesalerUserInput,
  ErrorCode,
  LegalDocumentDto,
  LegalDocumentType,
  OTP_TTL_SECONDS,
  OtpPurpose,
  OtpSendResultDto,
  PublishLegalDocumentDto,
  RegisterAffiliateDto,
  RegisterWholesalerUserInput,
  RmqClient,
  Role,
  SendOtpDto,
  UpdateAffiliateProfileDto,
  VerifyOtpDto,
} from '@app/common';
import { User } from '../entities/user.entity';
import { AuthService } from '../auth/auth.service';
import { OtpGuardService } from './otp-guard.service';

/** SMS kod bilan kira oladigan rollar (FE-04: «sotuvchi va optovik kirishi»); xodim parol bilan kiradi. */
const OTP_LOGIN_ROLES: ReadonlySet<Role> = new Set([
  Role.AFFILIATE,
  Role.WHOLESALER,
]);
/** Ro‘yxat tokeni: kod tasdiqlangandan oferta qadamigacha [taklif, BE-06 savol 3]. */
const REGISTRATION_TOKEN_TTL = '30m';
const REGISTRATION_PURPOSE = 'affiliate-registration';
const BCRYPT_ROUNDS = 10;

/**
 * BE-06 (TZ 6.1 SOT-1, T9-9): sotuvchi telefon va SMS kod bilan ro‘yxatdan o‘tadi va kiradi, ofertani qabul qiladi.
 * Kod qoidasi `OtpGuardService` da (randomInt, HMAC, 5 daqiqa); telefon va maqsad bo‘yicha 3 xato → 15 daqiqa
 * blok (hisob yangi kod so‘ralganda ham saqlanadi). Kod notification-service ga hodisa bilan ketadi (SMS — BE-24).
 */
@Injectable()
export class AffiliateAuthService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly auth: AuthService,
    private readonly otp: OtpGuardService,
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
      (!user ||
        !OTP_LOGIN_ROLES.has(user.role) ||
        user.isBlocked ||
        !user.isActive)
    )
      throw new BusinessException(
        'Bu raqam bilan sotuvchi hisobi topilmadi',
        ErrorCode.ACCOUNT_NOT_FOUND,
        HttpStatus.NOT_FOUND,
      );

    const code = await this.dataSource.transaction((m) =>
      this.otp.issue(m, phone, purpose),
    );
    await this.otp.cleanup(this.dataSource);
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
    // natija tranzaksiyada yoziladi (xato hisobi, blok), xato — commit dan keyin
    const result = await this.dataSource.transaction((m) =>
      this.otp.check(m, phone, purpose, code),
    );
    this.otp.throwUnlessOk(result);

    if (purpose === OtpPurpose.REGISTER) {
      const registrationToken = this.jwt.sign(
        { sub: phone, purpose: REGISTRATION_PURPOSE, jti: randomUUID() },
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
    // Telefoni SMS bilan birinchi marta tasdiqlanmoqda (hisob eski parol yo‘li bilan ochilgan bo‘lishi mumkin):
    // parol almashtiriladi, eski sessiyalar yopiladi — raqam egasi bo‘lmagan odam kirib qolmasin.
    const rotated = (await this.dataSource.query(
      `UPDATE identity.users
          SET password_hash = $2, auth_version = auth_version + 1, phone_verified_at = now(), updated_at = now()
        WHERE id = $1 AND phone_verified_at IS NULL
        RETURNING id`,
      [
        user.id,
        await bcrypt.hash(randomBytes(32).toString('hex'), BCRYPT_ROUNDS),
      ],
    )) as unknown[] | [unknown[], number];
    const changed = Array.isArray(rotated[0]) ? rotated[0] : rotated;
    if ((changed as unknown[]).length) {
      await this.auth.logout(String(user.id));
      const fresh = await this.users.findOneByOrFail({ id: user.id });
      return this.auth.buildAuthResult(fresh);
    }
    return this.auth.buildAuthResult(user);
  }

  // ------------------------------------------------------------------ ro‘yxat

  async registerAffiliate(
    dto: RegisterAffiliateDto,
    ip: string | null,
  ): Promise<Awaited<ReturnType<AuthService['buildAuthResult']>>> {
    return this.registerWithDocuments(
      dto?.registrationToken,
      Role.AFFILIATE,
      '',
      ip,
      {
        documents: [
          [LegalDocumentType.AFFILIATE_OFFER, dto?.offerVersion],
          [LegalDocumentType.PERSONAL_DATA_CONSENT, dto?.consentVersion],
        ],
        notPublished:
          'Sotuvchi ofertasi yoki rozilik matni hali e’lon qilinmagan — ro‘yxat ochilmagan',
        wrongVersion:
          'Sotuvchi ofertasi va rozilikning joriy versiyasini qabul qiling',
      },
    );
  }

  /**
   * BE-30 (OPT-1): optovik — SMS tasdiqlangan raqam, elektron komissiya shartnomasi va rozilik (joriy versiyalar).
   * Optovik yozuvini (rekvizitlar) gateway keyin catalog da ochadi.
   */
  async registerWholesaler(
    dto: RegisterWholesalerUserInput,
    ip: string | null,
  ): Promise<Awaited<ReturnType<AuthService['buildAuthResult']>>> {
    return this.registerWithDocuments(
      dto?.registrationToken,
      Role.WHOLESALER,
      String(dto?.name ?? '')
        .trim()
        .slice(0, 100),
      ip,
      {
        documents: [
          [LegalDocumentType.WHOLESALER_CONTRACT, dto?.contractVersion],
          [LegalDocumentType.PERSONAL_DATA_CONSENT, dto?.consentVersion],
        ],
        notPublished:
          'Komissiya shartnomasi yoki rozilik matni hali e’lon qilinmagan — optovik ro‘yxati ochilmagan',
        wrongVersion:
          'Komissiya shartnomasi va rozilikning joriy versiyasini qabul qiling',
      },
    );
  }

  /**
   * BE-30: admin kiritgan optovikka kabinet — shu raqamga WHOLESALER foydalanuvchisi (bor bo‘lsa — o‘sha). Raqam
   * boshqa roldagi foydalanuvchiniki bo‘lsa — 409. Kirish SMS kod bilan (parol yo‘q).
   */
  async ensureWholesalerUser(
    dto: EnsureWholesalerUserInput,
  ): Promise<{ userId: string; created: boolean }> {
    const phone = String(dto?.phone ?? '').trim();
    // SMS kod bilan kira oladigan raqam bo‘lsin (lid qoidasi bilan bir xil operator kodlari)
    if (!this.operatorAllowed(phone))
      throw new BadRequestException(
        'Telefon +998XXXXXXXXX formatida va ruxsat etilgan operatorda bo‘lishi kerak',
      );
    return this.dataSource.transaction(async (m) => {
      await m.query(
        `SELECT pg_advisory_xact_lock(hashtext('identity.register:' || $1))`,
        [phone],
      );
      const exists = await m.getRepository(User).findOne({ where: { phone } });
      if (exists) {
        if (exists.role !== Role.WHOLESALER || exists.isDeleted)
          throw new BusinessException(
            'Bu raqam boshqa foydalanuvchiga tegishli',
            ErrorCode.PHONE_ALREADY_REGISTERED,
            HttpStatus.CONFLICT,
          );
        return { userId: String(exists.id), created: false };
      }
      const created = await m.getRepository(User).save(
        m.getRepository(User).create({
          name: String(dto?.name ?? '')
            .trim()
            .slice(0, 100),
          phone,
          email: null,
          passwordHash: await bcrypt.hash(
            randomBytes(32).toString('hex'),
            BCRYPT_ROUNDS,
          ),
          role: Role.WHOLESALER,
          isActive: true,
        }),
      );
      return { userId: String(created.id), created: true };
    });
  }

  /**
   * BE-30: ro‘yxat kabinetda yakunlanadi (optovik yozuvi ochilmay qolgan bo‘lsa) — shartnoma va rozilikning joriy
   * versiyasi qabul qilinadi (takror — bir marta yoziladi). Faqat WHOLESALER.
   */
  async acceptWholesalerDocuments(
    userId: string,
    versions: { contractVersion: unknown; consentVersion: unknown },
    ip: string | null,
  ): Promise<{ contractVersion: string; consentVersion: string }> {
    const user = await this.users.findOne({
      where: { id: String(userId), isDeleted: false },
    });
    if (!user || user.role !== Role.WHOLESALER)
      throw new NotFoundException('Optovik foydalanuvchisi topilmadi');
    const contract = await this.currentDocument(
      LegalDocumentType.WHOLESALER_CONTRACT,
    );
    const consent = await this.currentDocument(
      LegalDocumentType.PERSONAL_DATA_CONSENT,
    );
    if (!contract?.sections.length || !consent?.sections.length)
      throw new BusinessException(
        'Komissiya shartnomasi yoki rozilik matni hali e’lon qilinmagan',
        ErrorCode.OFFER_NOT_ACCEPTED,
        HttpStatus.CONFLICT,
      );
    if (
      versions?.contractVersion !== contract.version ||
      versions?.consentVersion !== consent.version
    )
      throw new BusinessException(
        'Komissiya shartnomasi va rozilikning joriy versiyasini qabul qiling',
        ErrorCode.OFFER_NOT_ACCEPTED,
        HttpStatus.BAD_REQUEST,
      );
    for (const doc of [contract, consent])
      await this.dataSource.query(
        `INSERT INTO identity.user_agreement (user_id, type, version, ip) VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, type, version) DO NOTHING`,
        [user.id, doc.type, doc.version, ip],
      );
    return {
      contractVersion: contract.version,
      consentVersion: consent.version,
    };
  }

  private async registerWithDocuments(
    registrationToken: unknown,
    role: Role.AFFILIATE | Role.WHOLESALER,
    name: string,
    ip: string | null,
    rules: {
      documents: Array<[LegalDocumentType, unknown]>;
      notPublished: string;
      wrongVersion: string;
    },
  ): Promise<Awaited<ReturnType<AuthService['buildAuthResult']>>> {
    let phone: string;
    try {
      const payload = this.jwt.verify<{ sub: string; purpose: string }>(
        String(registrationToken ?? ''),
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
    const docs = await Promise.all(
      rules.documents.map(([type]) => this.currentDocument(type)),
    );
    // Matni yo‘q hujjatni qabul qilib bo‘lmaydi (seed 1.0 bo‘sh — yurist matni EQ-10 dan keyin e’lon qilinadi)
    if (docs.some((doc) => !doc?.sections.length))
      throw new BusinessException(
        rules.notPublished,
        ErrorCode.OFFER_NOT_ACCEPTED,
        HttpStatus.CONFLICT,
      );
    // «Oferta qabul qilinmasa ro‘yxat tugamaydi» — versiya joriy hujjatga teng bo‘lishi shart
    if (rules.documents.some(([, version], i) => version !== docs[i]!.version))
      throw new BusinessException(
        rules.wrongVersion,
        ErrorCode.OFFER_NOT_ACCEPTED,
        HttpStatus.BAD_REQUEST,
      );

    const user = await this.dataSource.transaction(async (m) => {
      // parallel ikki so‘rov: telefon bo‘yicha qulf — ikkinchisi «allaqachon ro‘yxatda» oladi (500 emas)
      await m.query(
        `SELECT pg_advisory_xact_lock(hashtext('identity.register:' || $1))`,
        [phone],
      );
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
          name,
          phone,
          email: null,
          // parol yo‘q — kirish SMS kod bilan; tasodifiy xesh parol bilan kirishni yopadi
          passwordHash: await bcrypt.hash(
            randomBytes(32).toString('hex'),
            BCRYPT_ROUNDS,
          ),
          role,
          isActive: true,
        }),
      );
      await m.query(
        `UPDATE identity.users SET phone_verified_at = now() WHERE id = $1`,
        [created.id],
      );
      for (const doc of docs)
        await m.query(
          `INSERT INTO identity.user_agreement (user_id, type, version, ip) VALUES ($1, $2, $3, $4)`,
          [created.id, doc!.type, doc!.version, ip],
        );
      return created;
    });
    return this.auth.buildAuthResult(user);
  }

  // ------------------------------------------------------------------ hujjatlar

  /** `version` — aniq versiya (BE-30: optovik qabul qilgan shartnoma matni PDF uchun); yo‘q bo‘lsa — joriy. */
  async legalDocument(
    type: string,
    version?: string,
  ): Promise<LegalDocumentDto> {
    const doc = await this.currentDocument(this.documentType(type), version);
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
    // joriy e’lon qilingan versiyasi hali qabul qilinmagan hujjatlar («Sotuvchi ofertasi yangilandi» banneri)
    const pendingAgreements: AffiliateProfileDto['pendingAgreements'] = [];
    for (const type of [
      LegalDocumentType.AFFILIATE_OFFER,
      LegalDocumentType.PERSONAL_DATA_CONSENT,
    ]) {
      const doc = await this.currentDocument(type);
      if (
        doc?.sections.length &&
        !rows.some((r) => r.type === type && r.version === doc.version)
      )
        pendingAgreements.push({ type, version: doc.version });
    }
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
      pendingAgreements,
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
      value === LegalDocumentType.PERSONAL_DATA_CONSENT ||
      value === LegalDocumentType.WHOLESALER_CONTRACT
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

  private async currentDocument(
    type: LegalDocumentType,
    version?: string,
  ): Promise<LegalDocumentDto | null> {
    const [row] = (await this.dataSource.query(
      version !== undefined
        ? `SELECT type, version, effective_at AS "effectiveAt", created_at AS "createdAt", summary, sections
             FROM identity.legal_document WHERE type = $1 AND version = $2`
        : `SELECT type, version, effective_at AS "effectiveAt", created_at AS "createdAt", summary, sections
             FROM identity.legal_document
            WHERE type = $1 AND (effective_at IS NULL OR effective_at <= now())
            ORDER BY COALESCE(effective_at, created_at) DESC, id DESC LIMIT 1`,
      version !== undefined ? [type, String(version)] : [type],
    )) as Array<{
      type: LegalDocumentType;
      version: string;
      effectiveAt: Date | null;
      createdAt: Date;
      summary: LegalDocumentDto['summary'];
      sections: LegalDocumentDto['sections'];
    }>;
    if (!row) return null;
    return {
      type: row.type,
      version: row.version,
      // null — matn hali yo‘q («e’lon qilinadi»); matnli hujjat sanasiz e’lon qilingan bo‘lsa — e’lon vaqti
      effectiveAt: row.effectiveAt
        ? new Date(row.effectiveAt).toISOString()
        : (row.sections ?? []).length
          ? new Date(row.createdAt).toISOString()
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
