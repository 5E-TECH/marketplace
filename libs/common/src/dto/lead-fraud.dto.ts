import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { IsLeadBigintId, LeadStatus, trimLeadText } from './lead.dto';
import { OperatorWorkState } from './lead-operator.dto';

/**
 * BE-35: nazoratchi (OPR-8: qizil ro‘yxat, lidni qayta taqsimlash), firibgarlik markazi (ADM-4, TZ 7-bo‘lim)
 * va admin «Rad etildi» lidni qayta ochishi (TZ 3-bo‘lim ruxsatlar jadvali, 5-bo‘lim 10-qoida).
 */

/** Qizil ro‘yxatga tushish sababi (TZ 9 «Real vaqt»: vaqti o‘tgan qo‘ng‘iroqlar va 10 daqiqadan ortiq kutgan yangi lidlar). */
export enum RedListReason {
  /** Navbatda 10 daqiqadan ortiq kutgan yangi lid. */
  NEW_WAITING = 'NEW_WAITING',
  /** Vaqti o‘tgan rejalashtirilgan qo‘ng‘iroq (mijoz aytgan vaqt). */
  CALLBACK_OVERDUE = 'CALLBACK_OVERDUE',
}

export class RedListItemDto {
  @ApiProperty({ example: '1277' }) leadId: string;
  @ApiProperty({ example: 'Mohira' }) customerName: string;
  @ApiProperty({ example: '501' }) productId: string;
  @ApiProperty({ example: 'Oshxona tarozisi' }) productName: string;
  @ApiProperty({ enum: RedListReason }) reason: RedListReason;
  @ApiProperty({ enum: LeadStatus, example: LeadStatus.NEW })
  status: LeadStatus;

  @ApiProperty({
    example: '2027-01-14T08:58:00.000Z',
    description:
      'Kutish boshlangan vaqt: yangi lid — ariza vaqti, qayta qo‘ng‘iroq — rejalashtirilgan vaqt',
  })
  since: Date;

  @ApiProperty({ example: 39, description: 'Necha daqiqa kutmoqda' })
  waitingMinutes: number;

  @ApiProperty({
    example: '41',
    nullable: true,
    type: String,
    description: 'Lid kimda: bron qilgan yoki qayta qo‘ng‘iroq egasi',
  })
  operatorId: string | null;

  @ApiProperty({
    enum: OperatorWorkState,
    nullable: true,
    description: 'Egasining holati (tanaffus, oflayn)',
  })
  operatorState: OperatorWorkState | null;

  @ApiProperty({
    example: 14,
    nullable: true,
    type: Number,
    description:
      'Umumiy navbatdagi o‘rni (7-qoida tartibi); lid operatorda bo‘lsa bo‘sh',
  })
  queuePosition: number | null;

  @ApiProperty({
    example: '2027-01-14T09:45:00.000Z',
    nullable: true,
    type: String,
    description:
      'Operatordagi qayta qo‘ng‘iroq qachon umumiy navbatga qaytadi (4-qoida: vaqtidan 15 daqiqa keyin)',
  })
  returnsToQueueAt: Date | null;

  @ApiProperty({ example: 0 }) attempts: number;
}

export class RedListDto {
  @ApiProperty({ example: '2027-01-14T09:37:00.000Z' }) generatedAt: Date;
  @ApiProperty({ example: 14, description: 'Umumiy navbatdagi lidlar' })
  queueSize: number;

  @ApiProperty({ example: 3 }) newWaiting: number;
  @ApiProperty({ example: 4 }) callbackOverdue: number;
  @ApiProperty({ type: [RedListItemDto] }) items: RedListItemDto[];
}

export class TransferLeadDto {
  @ApiProperty({ example: '41', description: 'Qaysi operatorga' })
  @IsLeadBigintId('operatorId')
  operatorId: string;

  @ApiPropertyOptional({ example: 'Operator oflayn bo‘ldi', maxLength: 500 })
  @IsOptional()
  @Transform(trimLeadText)
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class LeadTransferDto {
  @ApiProperty({ example: '1237' }) leadId: string;
  @ApiProperty({ example: '2027-01-14T09:21:00.000Z' }) at: Date;
  @ApiProperty({ example: '38', nullable: true, type: String })
  fromOperatorId: string | null;

  @ApiProperty({ example: '41' }) toOperatorId: string;
  @ApiProperty({ example: '7', description: 'Kim o‘tkazdi' })
  actorId: string;

  @ApiProperty({
    example: 'Operator oflayn bo‘ldi',
    nullable: true,
    type: String,
  })
  reason: string | null;
}

export class LeadTransfersQueryDto {
  @ApiPropertyOptional({
    example: '2027-01-14',
    description: 'Toshkent kuni; berilmasa — bugun',
  })
  @IsOptional()
  @IsDateString()
  date?: string;
}

export class ReopenLeadDto {
  @ApiProperty({
    example: 'Mijoz qayta qo‘ng‘iroq qilib, buyurtma bermoqchi',
    maxLength: 500,
  })
  @Transform(trimLeadText)
  @IsString()
  @IsNotEmpty({ message: 'reason qayta ochish sababi majburiy' })
  @MaxLength(500)
  reason: string;
}

export class LeadReopenedDto {
  @ApiProperty({ example: '1092' }) leadId: string;
  @ApiProperty({ enum: LeadStatus, example: LeadStatus.NEW })
  status: LeadStatus;
}

/** TZ 7-bo‘lim xavflari. */
export enum FraudRule {
  /** Sifatsiz yoki bot trafik: sahifada yaroqli < 60% yoki tasdiq < 25% (kamida 50 lid). */
  QUALITY = 'QUALITY',
  /** Sotuvchining o‘zi yoki tanishlari orqali buyurtma. */
  SELF_ORDER = 'SELF_ORDER',
  /** Mijoz bazasini o‘g‘irlash. */
  CUSTOMER_THEFT = 'CUSTOMER_THEFT',
  /** Soxta tasdiq (operator bonus uchun). */
  FAKE_CONFIRM = 'FAKE_CONFIRM',
  /** Ketma-ket rad etuvchi mijoz (qora ro‘yxat). */
  BLACKLIST = 'BLACKLIST',
  /** Kuryerdagi naqd pul (Elchi sverkasi farqi). */
  COURIER_CASH = 'COURIER_CASH',
  /** Aldovli reklama. */
  MISLEADING_AD = 'MISLEADING_AD',
  /** Raqobatchidan spam lid: bir IP dan ko‘p ariza. */
  SPAM_IP = 'SPAM_IP',
}

export enum FraudIncidentStatus {
  /** Qaror kutilmoqda. */
  OPEN = 'OPEN',
  /** Chora qo‘llanib yopildi. */
  RESOLVED = 'RESOLVED',
  /** «Asossiz» — chorasiz yopildi. */
  DISMISSED = 'DISMISSED',
}

/** Chora turlari (TZ 7: jazolar uch qadamda — ogohlantirish → haqni ushlab turish → bloklash). */
export enum FraudActionType {
  WARN = 'WARN',
  STOP_STREAM = 'STOP_STREAM',
  HOLD_FEE = 'HOLD_FEE',
  RELEASE_FEE = 'RELEASE_FEE',
  BLOCK_AFFILIATE = 'BLOCK_AFFILIATE',
  REVOKE_BONUS = 'REVOKE_BONUS',
  /** Tizim: bir IP dan ko‘p ariza — lidlar tekshiruvga olindi (BE-12). */
  REVIEW_HOLD = 'REVIEW_HOLD',
  /** Tizim: raqam qora ro‘yxatga qo‘shildi. */
  BLACKLIST = 'BLACKLIST',
  /** «Asossiz» — hodisa chorasiz yopildi. */
  DISMISS = 'DISMISS',
}

/** Admin qarori bilan qo‘llanadigan choralar. */
export const FRAUD_DECISIONS = [
  FraudActionType.WARN,
  FraudActionType.STOP_STREAM,
  FraudActionType.HOLD_FEE,
  FraudActionType.RELEASE_FEE,
  FraudActionType.BLOCK_AFFILIATE,
  FraudActionType.REVOKE_BONUS,
  FraudActionType.DISMISS,
] as const;
export type FraudDecision = (typeof FRAUD_DECISIONS)[number];

export class FraudIncidentQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({
    enum: ['OPEN', 'CLOSED'],
    description: 'Ochiq yoki yopilgan; berilmasa — hammasi',
  })
  @IsOptional()
  @IsEnum({ OPEN: 'OPEN', CLOSED: 'CLOSED' })
  state?: 'OPEN' | 'CLOSED';

  @ApiPropertyOptional({ enum: FraudRule })
  @IsOptional()
  @IsEnum(FraudRule)
  rule?: FraudRule;

  @ApiPropertyOptional({ example: '2027-01-08', description: 'Toshkent kuni' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: '2027-01-14', description: 'Toshkent kuni' })
  @IsOptional()
  @IsDateString()
  to?: string;
}

export class FraudIncidentDto {
  @ApiProperty({ example: '12' }) id: string;
  @ApiProperty({ enum: FraudRule }) rule: FraudRule;
  @ApiProperty({ enum: FraudIncidentStatus }) status: FraudIncidentStatus;
  @ApiProperty({ example: 'Sahifa m5t8kd: yaroqli lid 53%, tasdiq 21%' })
  summary: string;

  @ApiProperty({ example: '42', nullable: true, type: String })
  affiliateId: string | null;

  @ApiProperty({ example: '9', nullable: true, type: String })
  streamId: string | null;

  @ApiProperty({ example: null, nullable: true, type: String })
  leadId: string | null;

  @ApiProperty({ example: null, nullable: true, type: String })
  operatorId: string | null;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    example: { leads: 64, valid: 34, invalid: 24, duplicate: 6, confirmed: 7 },
    description: 'Dalil: tizim hisoblagan raqamlar yoki admin yozgan izoh',
  })
  evidence: Record<string, unknown>;

  @ApiProperty({
    enum: FraudActionType,
    nullable: true,
    description: 'Qoidaning keyingi chorasi (tizim taklifi)',
  })
  proposedAction: FraudActionType | null;

  @ApiProperty({
    example: null,
    nullable: true,
    type: String,
    description: 'Qo‘lda ochgan admin; bo‘sh — tizim',
  })
  detectedBy: string | null;

  @ApiProperty({ example: '2027-01-14T09:20:00.000Z' }) detectedAt: Date;
  @ApiProperty({ nullable: true, type: String }) closedAt: Date | null;
  @ApiProperty({ nullable: true, type: String }) closedBy: string | null;
}

export class FraudIncidentPageDto {
  @ApiProperty({ type: [FraudIncidentDto] }) items: FraudIncidentDto[];
  @ApiProperty({ example: 8 }) total: number;
  @ApiProperty({ example: 5 }) open: number;
  @ApiProperty({ example: 1 }) page: number;
  @ApiProperty({ example: 20 }) limit: number;
  @ApiProperty({ example: 1 }) totalPages: number;
}

export class CreateFraudIncidentDto {
  @ApiProperty({ enum: FraudRule }) @IsEnum(FraudRule) rule: FraudRule;

  @ApiPropertyOptional({ example: '42' })
  @IsOptional()
  @IsLeadBigintId('affiliateId')
  affiliateId?: string;

  @ApiPropertyOptional({ example: '9' })
  @IsOptional()
  @IsLeadBigintId('streamId')
  streamId?: string;

  @ApiPropertyOptional({ example: '1242' })
  @IsOptional()
  @IsLeadBigintId('leadId')
  leadId?: string;

  @ApiPropertyOptional({ example: '38' })
  @IsOptional()
  @IsLeadBigintId('operatorId')
  operatorId?: string;

  @ApiProperty({
    example:
      'Tasdiqlagan 12 buyurtmasidan 9 tasi rad etildi, yozuvlar tinglandi',
    maxLength: 1000,
  })
  @Transform(trimLeadText)
  @IsString()
  @IsNotEmpty({ message: 'reason dalil va sabab majburiy' })
  @MaxLength(1000)
  reason: string;
}

export class FraudDecisionDto {
  @ApiProperty({ enum: FRAUD_DECISIONS })
  @IsEnum(Object.fromEntries(FRAUD_DECISIONS.map((a) => [a, a])))
  action: FraudDecision;

  @ApiProperty({
    example:
      '11.01 dagi ogohlantirishdan keyin ham yaroqli lid 53%, tasdiq 21% (64 lid)',
    maxLength: 1000,
  })
  @Transform(trimLeadText)
  @IsString()
  @IsNotEmpty({ message: 'reason sabab va dalil majburiy' })
  @MaxLength(1000)
  reason: string;
}

export class FraudActionDto {
  @ApiProperty({ example: '31' }) id: string;
  @ApiProperty({ example: '12', nullable: true, type: String })
  incidentId: string | null;

  @ApiProperty({ enum: FraudActionType }) action: FraudActionType;
  @ApiProperty({ enum: FraudRule, nullable: true }) rule: FraudRule | null;
  @ApiProperty({
    example: 'STREAM',
    description: 'AFFILIATE, STREAM, LEAD, OPERATOR yoki PHONE',
  })
  targetType: string;

  @ApiProperty({
    example: '9',
    description: 'Telefon — niqoblangan (+998 90 *** ** 67)',
  })
  target: string;

  @ApiProperty({ example: '42', nullable: true, type: String })
  affiliateId: string | null;

  @ApiProperty({ example: '51 lid, yaroqli 55% (28 / 51) — chegara 60%' })
  reason: string;

  @ApiProperty({ type: 'object', additionalProperties: true, example: {} })
  evidence: Record<string, unknown>;
  @ApiProperty({
    example: '7',
    nullable: true,
    type: String,
    description: 'Kim; bo‘sh — tizim',
  })
  actorId: string | null;

  @ApiProperty({ example: '2027-01-11T11:05:00.000Z' }) createdAt: Date;
}

export class FraudActionQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ example: '12', description: 'Bitta hodisa choralari' })
  @IsOptional()
  @IsLeadBigintId('incidentId')
  incidentId?: string;

  @ApiPropertyOptional({ example: '9', description: 'Bitta sahifa choralari' })
  @IsOptional()
  @IsLeadBigintId('streamId')
  streamId?: string;

  @ApiPropertyOptional({ example: '42' })
  @IsOptional()
  @IsLeadBigintId('affiliateId')
  affiliateId?: string;

  @ApiPropertyOptional({
    enum: ['SYSTEM', 'ADMIN'],
    description: 'Kim: tizim yoki admin',
  })
  @IsOptional()
  @IsEnum({ SYSTEM: 'SYSTEM', ADMIN: 'ADMIN' })
  by?: 'SYSTEM' | 'ADMIN';

  @ApiPropertyOptional({ example: '2027-01-08' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: '2027-01-14' })
  @IsOptional()
  @IsDateString()
  to?: string;
}

export class FraudActionPageDto {
  @ApiProperty({ type: [FraudActionDto] }) items: FraudActionDto[];
  @ApiProperty({ example: 6 }) total: number;
  @ApiProperty({ example: 1 }) page: number;
  @ApiProperty({ example: 20 }) limit: number;
  @ApiProperty({ example: 1 }) totalPages: number;
}

export class FraudIncidentDetailDto extends FraudIncidentDto {
  @ApiProperty({
    type: [FraudActionDto],
    description:
      'Shu hodisa va uning sahifasi (yoki sotuvchisi) bo‘yicha choralar',
  })
  actions: FraudActionDto[];
}
