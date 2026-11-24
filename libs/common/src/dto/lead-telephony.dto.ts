import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateBy,
  ValidateIf,
} from 'class-validator';
import { Role } from '../enums';
import { IsLeadBigintId } from './lead.dto';
import { CallRecordingState } from './lead-attempt-call.dto';
import { LeadOutcome } from './lead-operator.dto';

/**
 * Telefoniya (BE-15; TZ 6.4 TEL-1–5, TEL-7; OPR-6, T4 `call`, T6). Provayder EQ-02 da: bu yerda unga bog‘liq bo‘lmagan
 * shartnoma — provayder xabarlari shu shaklga adapter orqali keltiriladi.
 */

/** Qo‘ng‘iroq bosqichi (T6; DZ-11 ro‘yxati). */
export enum CallStatus {
  /** Provayderga so‘rov yuborildi. */
  REQUESTED = 'REQUESTED',
  RINGING_OPERATOR = 'RINGING_OPERATOR',
  RINGING_CUSTOMER = 'RINGING_CUSTOMER',
  CONNECTED = 'CONNECTED',
  ENDED = 'ENDED',
  /** Provayder qo‘ng‘iroqni boshlay olmadi. */
  FAILED = 'FAILED',
}

/** Tugash sababi (T4 «tugash sababi»). */
export enum CallEndReason {
  /** Mijoz bilan suhbat bo‘ldi. */
  ANSWERED = 'ANSWERED',
  NO_ANSWER = 'NO_ANSWER',
  BUSY = 'BUSY',
  /** Mijoz telefoni o‘chiq yoki tarmoqdan tashqarida. */
  UNREACHABLE = 'UNREACHABLE',
  OPERATOR_NO_ANSWER = 'OPERATOR_NO_ANSWER',
  /** Operator suhbatgacha to‘xtatdi. */
  CANCELLED = 'CANCELLED',
  FAILED = 'FAILED',
}

/** T4 «kanal»: ofis (softfon, SIP stol telefoni), ilova VoIP, qayta qo‘ng‘iroq ko‘prigi (operator mobili, DZ-11). */
export enum CallChannel {
  OFFICE = 'OFFICE',
  APP_VOIP = 'APP_VOIP',
  APP_BRIDGE = 'APP_BRIDGE',
}

/** Operator telefoni turi: ichki raqam (SIP telefon yoki softfon) yoki mobil (masofaviy operator, DZ-11). */
export enum OperatorPhoneKind {
  EXTENSION = 'EXTENSION',
  MOBILE = 'MOBILE',
}

/** TEL-4: server holatidan taklif qilinadigan natija (boshqa sabablarda taklif yo‘q). */
export const CALL_OUTCOME: Partial<Record<CallEndReason, LeadOutcome>> = {
  [CallEndReason.NO_ANSWER]: LeadOutcome.NO_ANSWER,
  [CallEndReason.BUSY]: LeadOutcome.BUSY,
  [CallEndReason.UNREACHABLE]: LeadOutcome.PHONE_OFF,
};

/** TEL-4: shu natijalar qo‘lda kiritilmaydi — faqat server holati tasdiqlanadi. */
export const SERVER_OUTCOMES: readonly LeadOutcome[] = [
  LeadOutcome.NO_ANSWER,
  LeadOutcome.BUSY,
  LeadOutcome.PHONE_OFF,
];

export enum CallErrorCode {
  /** Telefoniya ulanmagan (`TELEPHONY_API_URL` yo‘q) — 503. */
  TELEPHONY_NOT_CONFIGURED = 'TELEPHONY_NOT_CONFIGURED',
  /** Provayder qo‘ng‘iroqni boshlamadi — 502. */
  TELEPHONY_FAILED = 'TELEPHONY_FAILED',
  /** Operatorga ichki raqam yoki telefon biriktirilmagan — 409. */
  OPERATOR_PHONE_MISSING = 'OPERATOR_PHONE_MISSING',
  /** So‘rov navbatda eskirib qolgan — 409, tugma qayta bosiladi. */
  CALL_REQUEST_EXPIRED = 'CALL_REQUEST_EXPIRED',
  /** Operatorda yoki shu lidda tugamagan qo‘ng‘iroq bor — 409. */
  CALL_ACTIVE = 'CALL_ACTIVE',
  /** «Javob bermadi», «band», «o‘chiq» — avval qo‘ng‘iroq qilinadi (TEL-4) — 409. */
  CALL_REQUIRED = 'CALL_REQUIRED',
  /** Natija server holatiga mos emas (TEL-4) — 409. */
  CALL_OUTCOME_MISMATCH = 'CALL_OUTCOME_MISMATCH',
  /** Yozuv yo‘q yoki hali tayyor emas — 404. */
  RECORDING_NOT_READY = 'RECORDING_NOT_READY',
}

/** Ichki RPC nomlari (gateway → lead). */
export const CALL_RPC = {
  START: 'lead.call.start',
  GET: 'lead.call.get',
  HANGUP: 'lead.call.hangup',
  LIST: 'lead.call.list',
  RECORDING_ACCESS: 'lead.call.recording-access',
  RECORDING_REF: 'lead.call.recording-ref',
  PHONE_GET: 'lead.operator-phone.get',
  PHONE_SET: 'lead.operator-phone.set',
  PHONE_DELETE: 'lead.operator-phone.delete',
} as const;

/** Telefoniya hodisalari (T4, T6): gateway (provayder webhooki) → lead-service. */
export const CALL_EVENTS = {
  STATUS: 'call.status',
  COMPLETED: 'call.completed',
  RECORDING_READY: 'recording.ready',
} as const;

const PROVIDER_REF = /^[\x21-\x7e]{1,200}$/;
const INSTANT =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;

/** Vaqt zonasi bilan to‘liq ISO vaqt (`…Z` yoki `…+05:00`): zonasiz yoki JS o‘qiy olmaydigan shakl — xato. */
function IsInstant(): PropertyDecorator {
  return ValidateBy({
    name: 'isInstant',
    validator: {
      validate: (value: unknown) =>
        typeof value === 'string' &&
        INSTANT.test(value) &&
        !Number.isNaN(Date.parse(value)),
      defaultMessage: () =>
        '$property vaqt zonasi bilan ISO 8601 bo‘lishi kerak',
    },
  });
}

interface CallEventBase {
  /** Provayder hodisasi ID si — takror kelsa bir marta ishlanadi. */
  eventId: string;
  /** Bizning qo‘ng‘iroq kaliti (`callRef`) — provayderga boshlashda berilgan. */
  callRef: string;
  at: string;
}

export interface CallStatusEvent extends CallEventBase {
  status:
    | CallStatus.RINGING_OPERATOR
    | CallStatus.RINGING_CUSTOMER
    | CallStatus.CONNECTED;
}

export interface CallCompletedEvent extends CallEventBase {
  endReason: CallEndReason;
  answeredAt: string | null;
  durationSeconds: number | null;
}

export interface RecordingReadyEvent extends CallEventBase {
  recordingRef: string;
}

/** `POST /webhooks/telephony` tanasi (normal shakl). */
export class TelephonyWebhookDto {
  @ApiProperty({ example: 'evt-8f1c', description: 'Hodisa ID si (takrorsiz)' })
  @Matches(PROVIDER_REF)
  eventId: string;

  @ApiProperty({
    example: '3f0e2f5c-7a1e-4c55-9b0a-0d4c9b1f2a10',
    description: 'Qo‘ng‘iroqni boshlashda berilgan `callRef`',
  })
  @IsUUID()
  callRef: string;

  @ApiProperty({
    enum: ['status', 'completed', 'recording'],
    example: 'completed',
  })
  @IsIn(['status', 'completed', 'recording'])
  type: 'status' | 'completed' | 'recording';

  @ApiProperty({ example: '2027-01-14T09:36:00.000Z' })
  @IsInstant()
  at: string;

  @ApiPropertyOptional({
    enum: [
      CallStatus.RINGING_OPERATOR,
      CallStatus.RINGING_CUSTOMER,
      CallStatus.CONNECTED,
    ],
    description: '`type: status` da majburiy',
  })
  @ValidateIf((dto: TelephonyWebhookDto) => dto.type === 'status')
  @IsIn([
    CallStatus.RINGING_OPERATOR,
    CallStatus.RINGING_CUSTOMER,
    CallStatus.CONNECTED,
  ])
  status?: CallStatusEvent['status'];

  @ApiPropertyOptional({
    enum: CallEndReason,
    description: '`type: completed` da majburiy',
  })
  @ValidateIf((dto: TelephonyWebhookDto) => dto.type === 'completed')
  @IsEnum(CallEndReason)
  endReason?: CallEndReason;

  @ApiPropertyOptional({
    example: '2027-01-14T09:33:10.000Z',
    description: 'Mijoz javob bergan vaqt; ANSWERED da majburiy',
  })
  @ValidateIf(
    (dto: TelephonyWebhookDto) =>
      dto.type === 'completed' &&
      (dto.endReason === CallEndReason.ANSWERED || dto.answeredAt != null),
  )
  @IsInstant()
  answeredAt?: string;

  @ApiPropertyOptional({
    example: 118,
    description: 'Suhbat davomiyligi, soniya; ANSWERED da majburiy',
  })
  @ValidateIf(
    (dto: TelephonyWebhookDto) =>
      dto.type === 'completed' &&
      (dto.endReason === CallEndReason.ANSWERED || dto.durationSeconds != null),
  )
  @IsInt()
  @Min(0)
  @Max(86_400)
  durationSeconds?: number;

  @ApiPropertyOptional({
    example: 'rec-5521',
    description:
      '`type: recording` da majburiy; provayderdagi yozuv kaliti (URL emas)',
  })
  @ValidateIf((dto: TelephonyWebhookDto) => dto.type === 'recording')
  @Matches(PROVIDER_REF)
  recordingRef?: string;
}

export class LeadCallDto {
  @ApiProperty({ example: '501' }) id: string;
  @ApiProperty({ example: '7001' }) leadId: string;
  @ApiProperty({ example: '41' }) operatorId: string;
  @ApiProperty({ example: 'Dilnoza R.' }) operatorName: string;
  @ApiProperty({ example: 'Aziza' }) customerName: string;
  @ApiProperty({ enum: CallChannel, example: CallChannel.OFFICE })
  channel: CallChannel;
  @ApiProperty({ enum: CallStatus, example: CallStatus.ENDED })
  status: CallStatus;
  @ApiProperty({
    example: '2027-01-14T09:32:00.000Z',
    description: 'Operator tugmani bosgan vaqt',
  })
  requestedAt: string;
  @ApiProperty({
    example: '2027-01-14T09:32:10.000Z',
    nullable: true,
    type: String,
    description: 'Mijoz javob bergan vaqt; javob bo‘lmasa null',
  })
  answeredAt: string | null;
  @ApiProperty({ nullable: true, type: String, example: null })
  endedAt: string | null;
  @ApiProperty({
    nullable: true,
    type: Number,
    example: 118,
    description: 'Suhbat davomiyligi, soniya',
  })
  durationSeconds: number | null;
  @ApiProperty({ enum: CallEndReason, nullable: true })
  endReason: CallEndReason | null;
  @ApiProperty({
    enum: LeadOutcome,
    nullable: true,
    example: LeadOutcome.NO_ANSWER,
    description:
      'TEL-4: server holatidan taklif — NO_ANSWER, BUSY yoki PHONE_OFF; boshqa holatda null',
  })
  suggestedOutcome: LeadOutcome | null;
  @ApiProperty({
    enum: CallRecordingState,
    example: CallRecordingState.READY,
    description:
      'NONE — suhbat bo‘lmagan; LIVE — suhbat ketmoqda; PENDING — yozuv kutilmoqda; MISSING — yozuvsiz, hisobotda xato (TEL-3)',
  })
  recording: CallRecordingState;
  @ApiProperty({
    nullable: true,
    type: String,
    example: '9001',
    description: 'Natija kiritilgan urinish; hali natijasiz — null',
  })
  attemptId: string | null;
}

const emptyToUndefined = ({ value }: { value: unknown }) =>
  value === '' ? undefined : value;

export class CallListQueryDto {
  @ApiPropertyOptional({ example: '2027-01-14', description: 'Toshkent kuni' })
  @IsOptional()
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'from YYYY-MM-DD' })
  from?: string;

  @ApiPropertyOptional({
    example: '2027-01-14',
    description: 'Toshkent kuni (shu kun ham)',
  })
  @IsOptional()
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'to YYYY-MM-DD' })
  to?: string;

  @ApiPropertyOptional({ example: '41' })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsLeadBigintId('operatorId')
  operatorId?: string;

  @ApiPropertyOptional({ example: '7001' })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsLeadBigintId('leadId')
  leadId?: string;

  @ApiPropertyOptional({
    enum: CallRecordingState,
    description: 'MISSING — yozuvsiz qo‘ng‘iroqlar (xato)',
  })
  @IsOptional()
  @IsEnum(CallRecordingState)
  recording?: CallRecordingState;

  @ApiPropertyOptional({ example: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100_000)
  page?: number;

  @ApiPropertyOptional({ example: 20, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class CallPageDto {
  @ApiProperty({ type: [LeadCallDto] }) items: LeadCallDto[];
  @ApiProperty({ example: 41 }) total: number;
  @ApiProperty({ example: 1 }) page: number;
  @ApiProperty({ example: 20 }) limit: number;
  @ApiProperty({
    example: 1,
    description:
      'TEL-3: yozuvsiz qo‘ng‘iroqlar soni — `recording` dan boshqa filtrlar bo‘yicha (hisobotda xato)',
  })
  missingRecordings: number;
}

export enum RecordingMode {
  LISTEN = 'LISTEN',
  DOWNLOAD = 'DOWNLOAD',
}

export class RecordingLinkRequestDto {
  @ApiPropertyOptional({
    enum: RecordingMode,
    default: RecordingMode.LISTEN,
    description: 'DOWNLOAD — faqat admin va superadmin (TEL-7)',
  })
  @IsOptional()
  @IsEnum(RecordingMode)
  mode?: RecordingMode;
}

/** lead-service javobi: ruxsat TEL-7 bo‘yicha; rad ham auditga yoziladi (gateway). */
export type RecordingAccess =
  | {
      allowed: true;
      callId: string;
      leadId: string;
      operatorId: string;
    }
  | {
      allowed: false;
      reason: 'NOT_OWNER' | 'DOWNLOAD_FORBIDDEN' | 'ROLE';
      callId: string;
      leadId: string;
      operatorId: string;
    };

export class SetOperatorPhoneDto {
  @ApiProperty({
    enum: OperatorPhoneKind,
    example: OperatorPhoneKind.EXTENSION,
  })
  @IsEnum(OperatorPhoneKind)
  kind: OperatorPhoneKind;

  @ApiProperty({
    example: '101',
    description: 'EXTENSION — ichki raqam (2–10 raqam); MOBILE — +998XXXXXXXXX',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  value: string;
}

export class OperatorPhoneDto {
  @ApiProperty({ example: '41' }) operatorId: string;
  @ApiProperty({ enum: OperatorPhoneKind }) kind: OperatorPhoneKind;
  @ApiProperty({ example: '101' }) value: string;
  @ApiProperty({ example: '3' }) updatedBy: string;
  @ApiProperty({ example: '2027-01-10T06:00:00.000Z' }) updatedAt: string;
}

/** Kim tinglay oladi (TZ 3-bo‘lim va TEL-7): operator — o‘zinikini; nazoratchi, admin va superadmin — hammasini. */
export const RECORDING_ALL_ROLES: readonly Role[] = [
  Role.SUPERVISOR,
  Role.ADMIN,
  Role.SUPERADMIN,
];
export const RECORDING_DOWNLOAD_ROLES: readonly Role[] = [
  Role.ADMIN,
  Role.SUPERADMIN,
];
