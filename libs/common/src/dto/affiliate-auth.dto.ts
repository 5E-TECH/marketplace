import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsJWT,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { SelfEmployedInfoDto } from './self-employed.dto';

/**
 * BE-06 (TZ 6.1 SOT-1, FE-04 taklifi `docs/api-taklif/fe-04-sotuvchi.md`): sotuvchi SMS kod bilan ro‘yxatdan
 * o‘tadi va kiradi, ofertani qabul qiladi. Kod 5 daqiqa amal qiladi, 3 xatodan keyin 15 daqiqa blok (SOT-1).
 */
export enum OtpPurpose {
  REGISTER = 'REGISTER',
  LOGIN = 'LOGIN',
}

export enum LegalDocumentType {
  AFFILIATE_OFFER = 'affiliate-offer',
  PERSONAL_DATA_CONSENT = 'personal-data-consent',
  /** BE-30: optovik bilan elektron komissiya shartnomasi (OPT-1). */
  WHOLESALER_CONTRACT = 'wholesaler-contract',
}

export const AFFILIATE_AUTH_RPC = {
  OTP_SEND: 'auth.otp.send',
  OTP_VERIFY: 'auth.otp.verify',
  REGISTER: 'auth.register.affiliate',
  LEGAL_GET: 'identity.legal.get',
  LEGAL_PUBLISH: 'identity.legal.publish',
  PROFILE_GET: 'identity.affiliate.profile.get',
  PROFILE_UPDATE: 'identity.affiliate.profile.update',
  AGREEMENT_ACCEPT: 'identity.affiliate.agreement.accept',
} as const;

/** SMS kod amal muddati, soniya (TZ SOT-1: 5 daqiqa). */
export const OTP_TTL_SECONDS = 300;
/** Ketma-ket xato urinishlar soni — blokdan oldin (TZ SOT-1: 3). */
export const OTP_MAX_FAILED = 3;
/** Blok muddati, soniya (TZ SOT-1: 15 daqiqa). */
export const OTP_BLOCK_SECONDS = 900;

const PHONE = /^\+998\d{9}$/;
const PHONE_MSG = { message: 'Telefon +998XXXXXXXXX formatida bo‘lishi kerak' };

export class SendOtpDto {
  @ApiProperty({ example: '+998973152286' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @Matches(PHONE, PHONE_MSG)
  phone: string;

  @ApiProperty({ enum: OtpPurpose, example: OtpPurpose.REGISTER })
  @IsEnum(OtpPurpose)
  purpose: OtpPurpose;
}

export class VerifyOtpDto extends SendOtpDto {
  @ApiProperty({ example: '305918' })
  @Matches(/^\d{6}$/, { message: 'Kod 6 raqamdan iborat' })
  code: string;
}

export class OtpSendResultDto {
  @ApiProperty({ example: 300, description: 'Kod necha soniya amal qiladi' })
  expiresIn: number;
  @ApiProperty({
    example: 'SENT',
    enum: ['SENT', 'DELAYED'],
    description: 'DELAYED — SMS provayder javob bermadi, server qayta yuboradi',
  })
  delivery: 'SENT' | 'DELAYED';
}

export class RegisterAffiliateDto {
  @ApiProperty({ description: 'OTP tasdig‘idan keyingi bir martalik token' })
  @IsJWT()
  registrationToken: string;

  @ApiProperty({
    example: '1.0',
    description: 'Qabul qilingan sotuvchi ofertasi versiyasi',
  })
  @IsString()
  @MaxLength(20)
  offerVersion: string;

  @ApiProperty({
    example: '1.0',
    description: 'Shaxsiy ma’lumotlarga rozilik versiyasi',
  })
  @IsString()
  @MaxLength(20)
  consentVersion: string;
}

export class LegalSummaryItemDto {
  @ApiProperty({ example: 'Haq' })
  @IsString()
  @MaxLength(100)
  term: string;

  @ApiProperty({
    example: 'faqat mijoz to‘lagan buyurtma uchun, so‘mda yoziladi.',
  })
  @IsString()
  @MaxLength(1000)
  text: string;
}

export class LegalSectionDto {
  @ApiProperty({ example: 's1' })
  @IsString()
  @MaxLength(40)
  id: string;

  @ApiProperty({ example: '1. Atamalar va taraflar' })
  @IsString()
  @MaxLength(300)
  title: string;

  @ApiProperty({ example: '…' })
  @IsString()
  @MaxLength(50_000)
  body: string;
}

export class LegalDocumentDto {
  @ApiProperty({
    enum: LegalDocumentType,
    example: LegalDocumentType.AFFILIATE_OFFER,
  })
  type: LegalDocumentType;
  @ApiProperty({ example: '1.0' })
  version: string;
  @ApiProperty({
    example: null,
    nullable: true,
    type: String,
    description:
      'Kuchga kirish vaqti; null — matn hali e’lon qilinmagan (ekranda «e’lon qilinadi»), bunday hujjat bilan ro‘yxat yopiq',
  })
  effectiveAt: string | null;
  @ApiProperty({ type: [LegalSummaryItemDto] })
  summary: LegalSummaryItemDto[];
  @ApiProperty({ type: [LegalSectionDto] })
  sections: LegalSectionDto[];
}

/** `PUT /admin/legal/documents/{type}` — superadmin yangi versiya e’lon qiladi (matn — yurist, EQ-10). */
export class PublishLegalDocumentDto {
  @ApiProperty({ example: '1.1' })
  @Matches(/^\d{1,3}(\.\d{1,3}){0,2}$/, {
    message: 'Versiya: 1.0, 1.1, 2.0.1 kabi',
  })
  version: string;

  @ApiPropertyOptional({
    type: String,
    example: '2026-12-01T00:00:00+05:00',
    nullable: true,
    description: 'Kuchga kirish vaqti; berilmasa — darhol (e’lon paytidan)',
  })
  @IsOptional()
  @IsDateString({ strict: true })
  effectiveAt?: string | null;

  @ApiProperty({ type: [LegalSummaryItemDto] })
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => LegalSummaryItemDto)
  summary: LegalSummaryItemDto[];

  @ApiProperty({ type: [LegalSectionDto] })
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => LegalSectionDto)
  sections: LegalSectionDto[];
}

export class AffiliateAgreementDto {
  @ApiProperty({ enum: LegalDocumentType })
  type: LegalDocumentType;
  @ApiProperty({ example: '1.0' })
  version: string;
  @ApiProperty({ example: '2026-11-22T04:14:00.000Z' })
  acceptedAt: string;
  @ApiProperty({
    example: true,
    description: 'Shu turdagi joriy (eng so‘nggi qabul qilingan) versiya',
  })
  current: boolean;
}

export class AffiliateProfileDto {
  @ApiProperty({ example: '1001' }) id: string;
  @ApiProperty({ example: '' }) firstName: string;
  @ApiProperty({ example: '' }) lastName: string;
  @ApiProperty({ example: '+998973152286' }) phone: string;
  @ApiProperty({ example: '2026-11-22T04:14:00.000Z' }) registeredAt: string;
  @ApiProperty({
    example: '2026-11-22T04:14:00.000Z',
    nullable: true,
    type: String,
  })
  lastLoginAt: string | null;
  @ApiProperty({ type: [AffiliateAgreementDto] })
  agreements: AffiliateAgreementDto[];
  @ApiProperty({
    example: [{ type: 'affiliate-offer', version: '1.1' }],
    description:
      'Joriy e’lon qilingan, lekin hali qabul qilinmagan versiyalar — qayta qabul kerak',
  })
  pendingAgreements: Array<{ type: LegalDocumentType; version: string }>;
  @ApiProperty({
    type: SelfEmployedInfoDto,
    required: false,
    description: 'Moliya javob bermasa — yo‘q',
  })
  selfEmployed?: SelfEmployedInfoDto;
  @ApiProperty({
    example: null,
    nullable: true,
    type: Object,
    required: false,
    description: 'Karta — BE-32 (hozircha null)',
  })
  card?: null;
}

export class UpdateAffiliateProfileDto {
  @ApiProperty({ example: 'Jasur' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstName: string;

  @ApiProperty({ example: 'Tursunov' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  lastName: string;
}

export class AcceptAgreementDto {
  @ApiProperty({ enum: LegalDocumentType })
  @IsEnum(LegalDocumentType)
  type: LegalDocumentType;

  @ApiProperty({ example: '1.1' })
  @IsString()
  @MaxLength(20)
  version: string;
}
