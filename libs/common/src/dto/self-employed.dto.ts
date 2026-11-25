import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PrivateDocumentContentType } from './wholesaler-cabinet.dto';

/**
 * BE-25 5-tur (ega, 2026-11-25: «Ha, qur»; SOT-1, TZ 8): sotuvchi JShShIR va maqom ma’lumotnomasini kabinetdan yuboradi,
 * moliya qo‘lda tekshiradi. Maqom tasdiqlanmaguncha pul yechish yopiq (BE-23, T01:471).
 */
export const SELF_EMPLOYED_RPC = {
  CURRENT: 'finance.self-employed.current',
  SUBMIT: 'finance.self-employed.submit',
  /** Ism-familiya o‘zgardi — tasdiqlangan yoki tekshirilayotgan maqom qayta tekshiruvga. */
  RENAME: 'finance.self-employed.rename',
  DOCUMENT_MINE: 'finance.self-employed.document-mine',
  DOCUMENT: 'finance.self-employed.document',
  LIST: 'finance.self-employed.list',
  GET: 'finance.self-employed.get',
  REVEAL: 'finance.self-employed.reveal',
  APPROVE: 'finance.self-employed.approve',
  REJECT: 'finance.self-employed.reject',
  REVOKE: 'finance.self-employed.revoke',
} as const;

/** file-service: sotuvchining yopiq ma’lumotnomasi. */
export const AFFILIATE_DOCUMENT_RPC = {
  STORE: 'file.affiliate-document.store',
  COMMIT: 'file.affiliate-document.commit',
  REMOVE: 'file.affiliate-document.remove',
} as const;

/** Platforma faqat shu faoliyat turidagi maqomni qabul qiladi (TZ 8: o‘zini o‘zi band qilganlar ro‘yxati, 34-band). */
export const SELF_EMPLOYED_ACTIVITY = 'SMM va internet-marketing';
/** JShShIR — 14 raqam (davlat standarti; TZ da yozilmagan [taklif]). */
export const PINFL = /^\d{14}$/;

export enum SelfEmployedStatus {
  NOT_SUBMITTED = 'NOT_SUBMITTED',
  PENDING = 'PENDING',
  VERIFIED = 'VERIFIED',
  REJECTED = 'REJECTED',
  REVOKED = 'REVOKED',
}

/** Rad va bekor qilish sabablari (P-A5 ro‘yxati [taklif]); NAME_CHANGED — tizim qo‘yadi. */
export enum SelfEmployedReason {
  PINFL_NOT_FOUND = 'PINFL_NOT_FOUND',
  STATUS_INACTIVE = 'STATUS_INACTIVE',
  ACTIVITY_MISMATCH = 'ACTIVITY_MISMATCH',
  DOCUMENT_UNREADABLE = 'DOCUMENT_UNREADABLE',
  NAME_MISMATCH = 'NAME_MISMATCH',
  NAME_CHANGED = 'NAME_CHANGED',
}

export const SELF_EMPLOYED_REASON_TEXT: Record<SelfEmployedReason, string> = {
  [SelfEmployedReason.PINFL_NOT_FOUND]: 'JShShIR ro‘yxatda topilmadi',
  [SelfEmployedReason.STATUS_INACTIVE]: 'Maqom faol emas',
  [SelfEmployedReason.ACTIVITY_MISMATCH]: 'Faoliyat turi 34-band emas',
  [SelfEmployedReason.DOCUMENT_UNREADABLE]: 'Hujjat o‘qilmaydi',
  [SelfEmployedReason.NAME_MISMATCH]: 'F.I.Sh. mos emas',
  [SelfEmployedReason.NAME_CHANGED]:
    'F.I.Sh. o‘zgardi — JShShIR ni qayta yuboring',
};

/** Moliya tanlaydigan sabablar (tizimniki emas). */
export const SELF_EMPLOYED_REVIEW_REASONS: SelfEmployedReason[] = Object.values(
  SelfEmployedReason,
).filter((r) => r !== SelfEmployedReason.NAME_CHANGED);

export enum SelfEmployedSource {
  /** Sotuvchi yubordi. */
  SELLER = 'SELLER',
  /** Ism-familiya o‘zgargani uchun qayta tekshiruv. */
  NAME_CHANGE = 'NAME_CHANGE',
  /** Moliya arizasiz qo‘lda belgiladi (BE-23). */
  MANUAL = 'MANUAL',
}

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** Sotuvchi ko‘radigan maqom (FE-04 `SelfEmployedInfo`) — to‘liq JShShIR yo‘q. */
export class SelfEmployedInfoDto {
  @ApiProperty({ enum: SelfEmployedStatus, example: 'PENDING' })
  status: SelfEmployedStatus;

  @ApiProperty({ type: String, nullable: true, example: '4018' })
  pinflLast4: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: SELF_EMPLOYED_ACTIVITY,
    description: 'Faoliyat turi (TZ 8, 34-band); yuborilmagan bo‘lsa — null',
  })
  activity: string | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    example: '2026-11-25T12:05:00.000Z',
  })
  submittedAt: string | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    example: null,
    description: 'Tasdiqlangan, rad etilgan yoki bekor qilingan vaqt',
  })
  checkedAt: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: null,
    description: 'Rad yoki bekor qilish sababi (matn)',
  })
  reason: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: null,
    description: 'Tekshiruvchi izohi',
  })
  comment: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'maqom-malumotnoma.pdf',
  })
  documentName: string | null;
}

export class SubmitSelfEmployedDto {
  @ApiProperty({
    example: '30101195600018',
    description:
      'JShShIR, 14 raqam (PINFL_INVALID). Shifrlangan saqlanadi, javoblarda faqat oxirgi 4 raqam',
  })
  // shakli controllerda tekshiriladi — frontend `PINFL_INVALID` kodini kutadi
  @IsString()
  @MaxLength(40)
  pinfl: string;

  @ApiPropertyOptional({
    example: '0f0e8f3a-1b2c-4d5e-8f90-a1b2c3d4e5f6.pdf',
    description:
      'Oldindan yuklangan ma’lumotnoma (`POST affiliate/self-employed/document`); ixtiyoriy',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  documentId?: string;
}

export class SelfEmployedDocumentDto {
  @ApiProperty({ example: '0f0e8f3a-1b2c-4d5e-8f90-a1b2c3d4e5f6.pdf' })
  documentId: string;
  @ApiProperty({ example: 'maqom-malumotnoma.pdf' }) name: string;
}

/** Ichki: file-service → gateway → finance. */
export interface AffiliateDocumentFile {
  objectKey: string;
  fileName: string;
  contentType: PrivateDocumentContentType;
  size: number;
}

/** Ichki: gateway → finance. */
export interface SubmitSelfEmployedInput {
  affiliateId: string;
  pinfl: string;
  fullName: string;
  document: AffiliateDocumentFile | null;
}

export class SelfEmployedListQueryDto {
  @ApiPropertyOptional({
    enum: [
      SelfEmployedStatus.PENDING,
      SelfEmployedStatus.VERIFIED,
      SelfEmployedStatus.REJECTED,
      SelfEmployedStatus.REVOKED,
    ],
    description: 'Berilmasa — hammasi',
  })
  @IsOptional()
  @IsIn([
    SelfEmployedStatus.PENDING,
    SelfEmployedStatus.VERIFIED,
    SelfEmployedStatus.REJECTED,
    SelfEmployedStatus.REVOKED,
  ])
  status?: SelfEmployedStatus;

  @ApiPropertyOptional({ example: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ example: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

/** Moliya navbatidagi qator (P-A5) — to‘liq JShShIR yo‘q. */
export class SelfEmployedApplicationDto {
  @ApiProperty({ example: '12' }) id: string;
  @ApiProperty({ example: '77' }) affiliateId: string;
  @ApiProperty({ example: 'Sevara Yusupova', description: 'Yuborilgandagi' })
  fullName: string;
  @ApiProperty({ enum: SelfEmployedStatus }) status: SelfEmployedStatus;
  @ApiProperty({ enum: SelfEmployedSource }) source: SelfEmployedSource;
  @ApiProperty({ type: String, nullable: true, example: '3365' })
  pinflLast4: string | null;
  @ApiProperty({ example: SELF_EMPLOYED_ACTIVITY }) activity: string;
  @ApiProperty({ type: String, format: 'date-time' }) submittedAt: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  checkedAt: string | null;
  @ApiProperty({ type: String, nullable: true, example: '15' })
  checkedBy: string | null;
  @ApiProperty({ enum: SelfEmployedReason, nullable: true, example: null })
  reason: SelfEmployedReason | null;
  @ApiProperty({ type: String, nullable: true, example: null })
  reasonText: string | null;
  @ApiProperty({ type: String, nullable: true, example: null })
  comment: string | null;
  @ApiProperty({
    type: String,
    nullable: true,
    example: 'maqom-malumotnoma.pdf',
  })
  documentName: string | null;
}

export class SelfEmployedCountsDto {
  @ApiProperty({ example: 4 }) PENDING: number;
  @ApiProperty({ example: 12 }) VERIFIED: number;
  @ApiProperty({ example: 1 }) REJECTED: number;
  @ApiProperty({ example: 0 }) REVOKED: number;
}

export class SelfEmployedPageDto {
  @ApiProperty({ type: [SelfEmployedApplicationDto] })
  items: SelfEmployedApplicationDto[];
  @ApiProperty({ example: 4 }) total: number;
  @ApiProperty({ example: 1 }) page: number;
  @ApiProperty({ example: 20 }) limit: number;
  @ApiProperty({ type: SelfEmployedCountsDto }) counts: SelfEmployedCountsDto;
}

export class SelfEmployedDetailDto extends SelfEmployedApplicationDto {
  @ApiProperty({
    example: true,
    description:
      'Shu sotuvchining oxirgi arizasimi (eskirganini tasdiqlab bo‘lmaydi)',
  })
  current: boolean;
  @ApiProperty({
    example: 130000,
    description: 'Mavjud pul, so‘m — tasdiqni kutayotgan to‘lov',
  })
  available: number;
  @ApiProperty({
    type: [String],
    example: [],
    description:
      'Shu JShShIR bilan tekshirilayotgan yoki tasdiqlangan boshqa sotuvchilar [taklif — faqat ogohlantirish]',
  })
  samePinflAffiliateIds: string[];
}

export class RejectSelfEmployedDto {
  @ApiProperty({ enum: SELF_EMPLOYED_REVIEW_REASONS })
  @IsIn(SELF_EMPLOYED_REVIEW_REASONS)
  reason: SelfEmployedReason;

  @ApiPropertyOptional({
    example: 'Hujjatda boshqa faoliyat turi.',
    description: 'Sotuvchiga ko‘rinadi',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  comment?: string;
}

export class RevokeSelfEmployedDto extends RejectSelfEmployedDto {}

export class PinflDto {
  @ApiProperty({ example: '30101195600018' }) pinfl: string;
}

/** Ichki: gateway → finance qarori. */
export interface SelfEmployedDecisionInput {
  id: string;
  reviewerId: string;
  /** APPROVE: sotuvchining hozirgi ism-familiyasi (identity) — arizadagidan farq qilsa tasdiqlanmaydi. */
  currentFullName?: string;
  reason?: SelfEmployedReason;
  comment?: string;
}

/** Bo‘sh joylari bitta, chetlari kesilgan ism-familiya — solishtirish uchun. */
export function affiliateFullName(profile: {
  firstName?: string | null;
  lastName?: string | null;
}): string {
  return normalizeFullName(
    `${profile?.firstName ?? ''} ${profile?.lastName ?? ''}`,
  );
}

export function normalizeFullName(value: unknown): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 255);
}
