import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
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
import { CheckoutDeliveryDestination } from './cart.dto';
import { LeadSource, LeadStatus } from './lead.dto';

// Lid-sotuv: operator ish joyi, nazoratchi va admin lidlar ro‘yxati (BE-25 shartnomasi).
// Real kod: BE-13 (navbat, natija), BE-38 (manzil), BE-42 (ro‘yxat, mijoz tarixi), BE-28 (statistika).
// Rollar OPERATOR_LEAD va SUPERVISOR BE-05 da qo‘shiladi; hozirgi Role.OPERATOR — do‘kon xodimi.
// S1/S3 varianti hech bir javobda yo‘q (sinov-s1-s3.md «Ko‘r sinov»).

/** Operator natijasi (OPR-3, TZ 5-bo‘lim). Nomlar [taklif]. */
export enum LeadOutcome {
  CONFIRMED = 'CONFIRMED',
  NO_ANSWER = 'NO_ANSWER',
  BUSY = 'BUSY',
  PHONE_OFF = 'PHONE_OFF',
  CALL_LATER = 'CALL_LATER',
  THINKING = 'THINKING',
  REJECTED = 'REJECTED',
  INVALID = 'INVALID',
  DUPLICATE = 'DUPLICATE',
}

/** Rad sababi (OPR-3; content-spec: Qimmat, Kerak emas, Boshqa joydan oldi, Boshqa sabab). Nomlar [taklif]. */
export enum LeadRejectReason {
  TOO_EXPENSIVE = 'TOO_EXPENSIVE',
  NOT_NEEDED = 'NOT_NEEDED',
  BOUGHT_ELSEWHERE = 'BOUGHT_ELSEWHERE',
  OTHER = 'OTHER',
}

/** Operator holati (T4 operator_state). BREAK — yangi lid berilmaydi. */
export enum OperatorWorkState {
  ONLINE = 'ONLINE',
  BREAK = 'BREAK',
  OFFLINE = 'OFFLINE',
}

export class LeadAddressDto {
  @ApiProperty({ example: '1726' }) regionSoato: string;
  @ApiProperty({ example: 'Toshkent shahri' }) regionName: string;
  @ApiProperty({ example: '1726266' }) districtSoato: string;
  @ApiProperty({ example: 'Yunusobod tumani' }) districtName: string;
  @ApiProperty({ example: 'Turkiston ko‘chasi, 27-uy' }) addressLine: string;

  @ApiProperty({
    enum: CheckoutDeliveryDestination,
    example: CheckoutDeliveryDestination.CENTER,
  })
  whereDeliver: CheckoutDeliveryDestination;

  @ApiProperty({
    example: null,
    nullable: true,
    type: String,
    description: 'Operator tasdiqlagan vaqt; bo‘sh — hali «formadan»',
  })
  confirmedAt: string | null;

  @ApiProperty({
    example: false,
    description:
      'Operator mijoz yozgan manzilni tuzatgan (eskisi lid tarixida)',
  })
  editedByOperator: boolean;
}

export class LeadProductRefDto {
  @ApiProperty({ example: '501' }) id: string;
  @ApiProperty({ example: 'Simsiz quloqchinlar' }) name: string;
  @ApiProperty({ example: 262000, description: 'Sahifadagi narx, so‘m' })
  salePrice: number;
}

export class LeadAttemptDto {
  @ApiProperty({ example: '2027-01-14T09:36:00.000Z' }) at: Date;
  @ApiProperty({ example: 'Dilnoza R.' }) operatorName: string;
  @ApiProperty({ enum: LeadOutcome, example: LeadOutcome.NO_ANSWER })
  outcome: LeadOutcome;

  @ApiProperty({ example: null, nullable: true, type: String })
  comment: string | null;
}

export class LeadHistoryEntryDto {
  @ApiProperty({ example: '2027-01-14T09:32:00.000Z' }) at: Date;
  @ApiProperty({ example: null, nullable: true, enum: LeadStatus })
  fromStatus: LeadStatus | null;

  @ApiProperty({ enum: LeadStatus, example: LeadStatus.NEW })
  toStatus: LeadStatus;

  @ApiProperty({
    example: 'Tizim',
    description: 'Kim o‘zgartirdi: operator ismi yoki «Tizim»',
  })
  actor: string;

  @ApiProperty({
    example: null,
    nullable: true,
    type: String,
    description: 'Izoh, masalan manzil tuzatilgani',
  })
  note: string | null;
}

/** Shu telefondagi oldingi lidlar (OPR-2, BE-42). */
export class LeadPreviousDto {
  @ApiProperty({ example: '6550' }) id: string;
  @ApiProperty({ example: '2027-01-05T11:04:00.000Z' }) createdAt: Date;
  @ApiProperty({ example: 'Elektr choynak' }) productName: string;
  @ApiProperty({ enum: LeadStatus, example: LeadStatus.REJECTED })
  status: LeadStatus;

  @ApiProperty({ example: null, nullable: true, type: String })
  orderId: string | null;

  @ApiProperty({ example: null, nullable: true, type: String })
  orderStatus: string | null;
}

/** Lid kartasi: operator (BE-13) va admin/nazoratchi (BE-42) uchun bitta shakl. */
export class LeadCardDto {
  @ApiProperty({ example: '7001' }) id: string;
  @ApiProperty({ enum: LeadStatus, example: LeadStatus.BOOKED })
  status: LeadStatus;

  @ApiProperty({ enum: LeadSource, example: LeadSource.LANDING })
  source: LeadSource;

  @ApiProperty({ example: 'Aziza' }) customerName: string;

  @ApiProperty({
    example: '+998 90 *** ** 67',
    description: 'Operatorga to‘liq raqam ko‘rsatilishi EQ-02 qaroriga bog‘liq',
  })
  phoneMasked: string;

  @ApiProperty({ type: LeadProductRefDto }) product: LeadProductRefDto;
  @ApiProperty({ example: 1, description: 'Miqdor (OPR-4)' }) quantity: number;
  @ApiProperty({ type: LeadAddressDto }) address: LeadAddressDto;

  @ApiProperty({
    example: null,
    nullable: true,
    type: String,
    description: 'Offerdagi suhbat skripti (OPR-2, BE-11)',
  })
  callScript: string | null;

  @ApiProperty({
    example: false,
    description: 'Buyurtma yaratilmadi: qoldiq yo‘q (order.create-failed)',
  })
  stockShortage: boolean;

  @ApiProperty({ example: 0 }) attemptsCount: number;

  @ApiProperty({ example: null, nullable: true, type: String })
  bookedUntil: string | null;

  @ApiProperty({ example: null, nullable: true, type: String })
  nextAttemptAt: string | null;

  @ApiProperty({ example: null, nullable: true, type: String })
  orderId: string | null;

  @ApiProperty({ type: [LeadAttemptDto] }) attempts: LeadAttemptDto[];
  @ApiProperty({ type: [LeadHistoryEntryDto] }) history: LeadHistoryEntryDto[];
  @ApiProperty({ type: [LeadPreviousDto] }) previousLeads: LeadPreviousDto[];
  @ApiProperty({ example: '2027-01-14T09:32:00.000Z' }) createdAt: Date;
}

/** Operatorning bronlari va rejalashtirilgan qo‘ng‘iroqlari (5 tagacha bron, OPR-1). */
export class OperatorLeadListItemDto {
  @ApiProperty({ example: '7001' }) id: string;
  @ApiProperty({ enum: LeadStatus, example: LeadStatus.BOOKED })
  status: LeadStatus;

  @ApiProperty({ example: 'Aziza' }) customerName: string;
  @ApiProperty({ example: 'Simsiz quloqchinlar' }) productName: string;

  @ApiProperty({ example: null, nullable: true, type: String })
  bookedUntil: string | null;

  @ApiProperty({
    example: null,
    nullable: true,
    type: String,
    description: 'Rejalashtirilgan qo‘ng‘iroq vaqti',
  })
  callbackAt: string | null;

  @ApiProperty({
    example: false,
    description: 'Qo‘ng‘iroqqa 5 daqiqadan kam qoldi (8-qoida)',
  })
  reminderDue: boolean;
}

/** POST /operator/leads/:id/result (OPR-3). */
export class SubmitLeadResultDto {
  @ApiProperty({ enum: LeadOutcome, example: LeadOutcome.CONFIRMED })
  @IsEnum(LeadOutcome)
  outcome: LeadOutcome;

  @ApiPropertyOptional({
    enum: LeadRejectReason,
    description: 'REJECTED da majburiy',
  })
  @IsOptional()
  @IsEnum(LeadRejectReason)
  rejectReason?: LeadRejectReason;

  @ApiPropertyOptional({
    example: '2027-01-15T10:00:00.000Z',
    description: 'CALL_LATER da majburiy, THINKING da ixtiyoriy',
  })
  @IsOptional()
  @IsDateString()
  callbackAt?: string;

  @ApiPropertyOptional({ example: 'Ertaga ishdan keyin qo‘ng‘iroq qilish' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;

  @ApiPropertyOptional({
    example: '6550',
    description: 'DUPLICATE: avvalgi lid ID si',
  })
  @IsOptional()
  @IsString()
  duplicateOfLeadId?: string;

  @ApiPropertyOptional({
    example: 1,
    minimum: 1,
    description: 'Miqdor (OPR-4)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity?: number;
}

export class LeadResultAcceptedDto {
  @ApiProperty({ example: '7001' }) leadId: string;
  @ApiProperty({ enum: LeadStatus, example: LeadStatus.CONFIRMED })
  status: LeadStatus;

  @ApiProperty({ example: null, nullable: true, type: String })
  nextAttemptAt: string | null;
}

/** PATCH /operator/leads/:id/address — manzilni tasdiqlash yoki tuzatish (OPR-4, BE-38). */
export class UpdateLeadAddressDto {
  @ApiProperty({ example: '1726' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  regionSoato: string;

  @ApiProperty({ example: '1726266' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  districtSoato: string;

  @ApiProperty({ example: 'Turkiston ko‘chasi, 27-uy' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  addressLine: string;

  @ApiProperty({
    enum: CheckoutDeliveryDestination,
    example: CheckoutDeliveryDestination.CENTER,
  })
  @IsEnum(CheckoutDeliveryDestination)
  whereDeliver: CheckoutDeliveryDestination;
}

export class UpdateOperatorStateDto {
  @ApiProperty({ enum: OperatorWorkState, example: OperatorWorkState.ONLINE })
  @IsEnum(OperatorWorkState)
  state: OperatorWorkState;
}

export class OperatorStateDto {
  @ApiProperty({ enum: OperatorWorkState, example: OperatorWorkState.ONLINE })
  state: OperatorWorkState;

  @ApiProperty({ example: 2 }) activeBookings: number;
  @ApiProperty({ example: 5, description: '6-qoida' }) maxBookings: number;
}

export class OperatorQueueOperatorDto {
  @ApiProperty({ example: '41' }) operatorId: string;
  @ApiProperty({ example: 'Dilnoza R.' }) name: string;
  @ApiProperty({ enum: OperatorWorkState, example: OperatorWorkState.ONLINE })
  state: OperatorWorkState;

  @ApiProperty({ example: 2 }) activeBookings: number;
}

/** Nazoratchi uchun minimal navbat ko‘rinishi (BE-13). */
export class OperatorQueueSummaryDto {
  @ApiProperty({ example: 37 }) newLeads: number;
  @ApiProperty({ example: 5 }) dueCallbacks: number;
  @ApiProperty({ example: 8 }) booked: number;
  @ApiProperty({ type: [OperatorQueueOperatorDto] })
  operators: OperatorQueueOperatorDto[];
}

export class LeadStatsPeriodQueryDto {
  @ApiProperty({ example: '2026-12-01', description: 'Toshkent sanasi' })
  @IsDateString()
  from: string;

  @ApiProperty({ example: '2026-12-31', description: 'Toshkent sanasi' })
  @IsDateString()
  to: string;
}

/** Operator statistikasi (OPR-7, BE-28). Bonus (14-qoida) EQ-04 dan keyin. */
export class OperatorStatsDto {
  @ApiProperty({ example: 38 }) attempts: number;
  @ApiProperty({ example: 9 }) confirmed: number;
  @ApiProperty({ example: 41, description: 'Tasdiq foizi' })
  approveRate: number;

  @ApiProperty({ example: 78, description: 'Sotilish foizi' })
  saleRate: number;

  @ApiProperty({
    example: 4,
    nullable: true,
    type: Number,
    description: 'Birinchi qo‘ng‘iroqqacha median, daqiqa',
  })
  firstCallMedianMinutes: number | null;
}

/** GET /admin/leads filtri (BE-42, FE-26). */
export class AdminLeadsQueryDto {
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

  @ApiPropertyOptional({ enum: LeadStatus })
  @IsOptional()
  @IsEnum(LeadStatus)
  status?: LeadStatus;

  @ApiPropertyOptional({ example: '77', description: 'Sotuvchi ID si' })
  @IsOptional()
  @IsString()
  affiliateId?: string;

  @ApiPropertyOptional({ example: '501' })
  @IsOptional()
  @IsString()
  productId?: string;

  @ApiPropertyOptional({ example: '41' })
  @IsOptional()
  @IsString()
  operatorId?: string;

  @ApiPropertyOptional({ example: '2026-12-01' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsOptional()
  @IsDateString()
  to?: string;
}

export class AdminLeadListItemDto {
  @ApiProperty({ example: '7001' }) id: string;
  @ApiProperty({ example: '2027-01-14T09:32:00.000Z' }) createdAt: Date;
  @ApiProperty({ enum: LeadStatus, example: LeadStatus.NEW })
  status: LeadStatus;

  @ApiProperty({ enum: LeadSource, example: LeadSource.LANDING })
  source: LeadSource;

  @ApiProperty({ example: 'Aziza' }) customerName: string;
  @ApiProperty({ example: '+998 90 *** ** 67' }) phoneMasked: string;
  @ApiProperty({ example: 'Simsiz quloqchinlar' }) productName: string;

  @ApiProperty({ example: 'Jasur T.', nullable: true, type: String })
  affiliateName: string | null;

  @ApiProperty({ example: null, nullable: true, type: String })
  operatorName: string | null;

  @ApiProperty({ example: null, nullable: true, type: String })
  orderId: string | null;
}

export class AdminLeadsPageDto {
  @ApiProperty({ type: [AdminLeadListItemDto] }) items: AdminLeadListItemDto[];
  @ApiProperty({ example: 42 }) total: number;
  @ApiProperty({ example: 1 }) page: number;
  @ApiProperty({ example: 20 }) limit: number;
  @ApiProperty({ example: 3 }) totalPages: number;
}
