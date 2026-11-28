import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { CheckoutDeliveryDestination } from './cart.dto';
import { LeadAttemptCallDto } from './lead-attempt-call.dto';
import { DeliveryDisplayMode } from '../pricing/price-calculator';
import {
  IsLeadBigintId,
  LeadSource,
  LeadStatus,
  trimLeadText,
} from './lead.dto';

// Lid-sotuv: operator ish joyi, nazoratchi va admin lidlar ro‘yxati (BE-25 shartnomasi).
// Real kod: BE-13 (navbat, natija), BE-38 (manzil), BE-42 (ro‘yxat, mijoz tarixi), BE-28 (statistika).
// Rollar (BE-05): operator ish joyi — OPERATOR_LEAD va SUPERVISOR; navbat xulosasi — SUPERVISOR va admin.
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

/**
 * Lid API sining o‘z xato kodlari (`errorCode`; AllExceptionsFilter saqlaydi). Nomlar [taklif].
 * Frontend matnga emas, kodga qarab holat ko‘rsatadi (error-codes.ts qoidasi).
 */
export enum LeadErrorCode {
  /** POST /operator/leads/next: navbatda lid yo‘q — 404 («navbat bo‘sh», operator-bosh). */
  LEAD_QUEUE_EMPTY = 'LEAD_QUEUE_EMPTY',
  /** Operator tanaffusda — 409 (TC4 FE-08). */
  OPERATOR_ON_BREAK = 'OPERATOR_ON_BREAK',
  /** Operator «chiqdi» holatida — avval «ishda» holatini tanlaydi — 409 [taklif]. */
  OPERATOR_OFFLINE = 'OPERATOR_OFFLINE',
  /** 5 ta bron to‘lgan — 409 (6-qoida, «5/5»). */
  BOOKING_LIMIT_REACHED = 'BOOKING_LIMIT_REACHED',
  /** Manzil tasdiqlanmagan lidga «Tasdiqlandi» — 400 (OPR-4, BE-38). */
  ADDRESS_NOT_CONFIRMED = 'ADDRESS_NOT_CONFIRMED',
  /** POST /leads: sotuvchi sahifasi hozir ariza qabul qilmaydi (holat OPEN emas) — 409 (BE-12, SF-02 TC8). */
  LANDING_NOT_OPEN = 'LANDING_NOT_OPEN',
  /** O‘tkazish: lid navbatda yoki operatorda emas (yopilgan, tekshiruvda, dublikat) — 409 (BE-35). */
  LEAD_NOT_TRANSFERABLE = 'LEAD_NOT_TRANSFERABLE',
  /** POST /storefront/orders: savatdagi mahsulot saytda sotuvda emas (narxi tasdiqlanmagan, olib tashlangan) — 409 (BE-34). */
  SITE_PRODUCT_UNAVAILABLE = 'SITE_PRODUCT_UNAVAILABLE',
  /** POST /storefront/orders: savat bo‘sh — 400 (BE-34). */
  SITE_CART_EMPTY = 'SITE_CART_EMPTY',
  /** SMS havola muddati o‘tgan yoki lidni operator olgan — 409, operator qo‘ng‘iroq qiladi (BE-34). */
  SITE_CONFIRM_EXPIRED = 'SITE_CONFIRM_EXPIRED',
  /** Qayta ochish faqat «Rad etildi» lidga — 409 (BE-35). */
  LEAD_NOT_REJECTED = 'LEAD_NOT_REJECTED',
  /** Shu raqam va mahsulotda faol lid bor — ikkinchisi ochilmaydi (LID-4) — 409 (BE-35). */
  ACTIVE_LEAD_EXISTS = 'ACTIVE_LEAD_EXISTS',
  /** Bo‘shatish: lid hech kimning bronida emas — 409 (BE-25, FE-26). */
  LEAD_NOT_BOOKED = 'LEAD_NOT_BOOKED',
  /** Bo‘shatish: operator hozir mijoz bilan gaplashmoqda — 409 (BE-25, FE-26). */
  LEAD_CALL_ACTIVE = 'LEAD_CALL_ACTIVE',
  /** Firibgarlik hodisasi allaqachon yopilgan — 409 (BE-35). */
  FRAUD_INCIDENT_CLOSED = 'FRAUD_INCIDENT_CLOSED',
  /** Chora hodisaga mos emas (masalan, sahifasiz hodisada «sahifani to‘xtatish») — 400 (BE-35). */
  FRAUD_ACTION_NOT_APPLICABLE = 'FRAUD_ACTION_NOT_APPLICABLE',
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

/**
 * Mijozga aytiladigan summa — serverdagi narx obyekti (FE-09, OPR-4; yetkazish ko‘rinishi BE-09).
 * Nomlar mavjud `DeliveryPreviewResultDto` bilan bir xil: subtotal, deliveryFee, totalAmount.
 */
export class LeadPriceDto {
  @ApiProperty({ example: 262000, description: 'Bitta tovar narxi, so‘m' })
  unitPrice: number;

  @ApiProperty({ example: 1 }) quantity: number;

  @ApiProperty({ example: 262000, description: 'Tovarlar, so‘m' })
  subtotal: number;

  @ApiProperty({
    enum: CheckoutDeliveryDestination,
    example: CheckoutDeliveryDestination.CENTER,
  })
  whereDeliver: CheckoutDeliveryDestination;

  @ApiProperty({
    example: 30000,
    description:
      'Ko‘rinadigan yetkazish, so‘m; rejim va og‘irlikka qarab, 0 — bepul (BE-09)',
  })
  deliveryFee: number;

  @ApiProperty({ example: 292000, description: 'Jami, so‘m' })
  totalAmount: number;

  @ApiPropertyOptional({
    enum: DeliveryDisplayMode,
    nullable: true,
    example: DeliveryDisplayMode.PARTIAL,
    description:
      'BE-25 (FE-09): yetkazish rejimi; katalog hisoblay olmasa null',
  })
  deliveryMode?: DeliveryDisplayMode | null;

  @ApiPropertyOptional({
    nullable: true,
    type: Number,
    example: 4200,
    description: 'BE-25: posilkaning jami og‘irligi, gramm',
  })
  weightGrams?: number | null;

  @ApiPropertyOptional({
    nullable: true,
    type: 'object',
    properties: { CENTER: { type: 'number' }, ADDRESS: { type: 'number' } },
    additionalProperties: false,
    example: { CENTER: 30000, ADDRESS: 50000 },
    description:
      'BE-25: shu miqdor uchun ikkala yetkazish turi; ko‘p tovarli posilkada null',
  })
  deliveryOptions?: Record<CheckoutDeliveryDestination, number> | null;

  @ApiPropertyOptional({
    nullable: true,
    type: 'object',
    properties: {
      base: { type: 'number' },
      extraKg: { type: 'number' },
      perExtraKg: { type: 'number' },
      baseWeightGrams: { type: 'number' },
    },
    additionalProperties: false,
    example: {
      base: 40000,
      extraKg: 3,
      perExtraKg: 4000,
      baseWeightGrams: 3000,
    },
    description:
      'BE-25: deliveryFee = base + extraKg × perExtraKg («40 000 + 3 × 4 000 = 52 000»). Bepul rejim va ko‘p tovarli posilkada null',
  })
  deliveryFormula?: {
    base: number;
    extraKg: number;
    perExtraKg: number;
    baseWeightGrams: number;
  } | null;
}

/** POST /operator/leads/:id/quote — miqdor yoki yetkazish turi o‘zgarganda summani oldindan ko‘rish (FE-09 TC2, TC3). */
export class LeadPriceQuoteDto {
  @ApiProperty({ example: 2, minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity: number;

  @ApiProperty({
    enum: CheckoutDeliveryDestination,
    example: CheckoutDeliveryDestination.ADDRESS,
  })
  @IsEnum(CheckoutDeliveryDestination)
  whereDeliver: CheckoutDeliveryDestination;
}

export class LeadAttemptDto {
  @ApiProperty({ example: '2027-01-14T09:36:00.000Z' }) at: Date;
  @ApiProperty({ example: 'Dilnoza R.' }) operatorName: string;
  @ApiProperty({ enum: LeadOutcome, example: LeadOutcome.NO_ANSWER })
  outcome: LeadOutcome;

  @ApiProperty({ example: null, nullable: true, type: String })
  comment: string | null;

  @ApiPropertyOptional({
    type: () => LeadAttemptCallDto,
    nullable: true,
    description:
      'BE-15 (TEL-3): qo‘ng‘iroq — boshlanish, javob, davomiylik, yozuv holati; qo‘ng‘iroqsiz urinishda null',
  })
  call?: LeadAttemptCallDto | null;
}

/** BE-25: tuzatilgan manzil maydoni — eski va yangi qiymat (viloyat va tuman nomi bilan). */
export class LeadHistoryChangeDto {
  @ApiProperty({
    enum: ['region', 'district', 'addressLine', 'whereDeliver'],
    example: 'district',
  })
  field: 'region' | 'district' | 'addressLine' | 'whereDeliver';

  @ApiProperty({ example: 'Qo‘qon shahri', nullable: true, type: String })
  from: string | null;

  @ApiProperty({ example: 'Farg‘ona shahri', nullable: true, type: String })
  to: string | null;
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

  @ApiPropertyOptional({
    type: [LeadHistoryChangeDto],
    nullable: true,
    description:
      'BE-25 (FE-09 TC5): manzil saqlanganda o‘zgargan maydonlar — bitta saqlash bitta yozuv. Bo‘sh — o‘zgarishsiz tasdiqlandi; manzilga aloqasi yo‘q yozuvda null',
  })
  changes?: LeadHistoryChangeDto[] | null;
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

  @ApiProperty({
    enum: LeadRejectReason,
    example: LeadRejectReason.TOO_EXPENSIVE,
    nullable: true,
    description: 'Rad sababi (OPR-2: «Rad etildi — «Qimmat»»)',
  })
  rejectReason: LeadRejectReason | null;
}

/** Lid kartasi: operator (BE-13) va admin/nazoratchi (BE-42) uchun bitta shakl. */
/** BE-34: saytdan ko‘p tovarli lidning bitta qatori (operator hamma tovarni bitta jami bilan ko‘radi — FE-29). */
export class LeadCardItemDto {
  @ApiProperty({
    example: '9001',
    description: 'BE-45: qator ID si (qo‘shimcha tovarni olib tashlash uchun)',
  })
  itemId: string;
  @ApiProperty({ example: '501' }) productId: string;
  @ApiProperty({ example: 'Simsiz quloqchin' }) name: string;
  @ApiProperty({ example: 1 }) quantity: number;
  @ApiProperty({
    example: 251000,
    description: 'Saytdagi (tasdiqlangan) narx, bir dona',
  })
  unitPrice: number;
  @ApiProperty({ example: 251000 }) lineTotal: number;
  @ApiProperty({
    example: false,
    description:
      'BE-45: operator qo‘shgan qo‘shimcha tovar (upsell); narx — tasdiqlangan narx',
  })
  upsell: boolean;
}

export class LeadCardDto {
  @ApiProperty({ example: '7001' }) id: string;
  @ApiProperty({ enum: LeadStatus, example: LeadStatus.BOOKED })
  status: LeadStatus;

  @ApiProperty({ enum: LeadSource, example: LeadSource.LANDING })
  source: LeadSource;

  @ApiProperty({ example: 'Aziza' }) customerName: string;

  @ApiProperty({
    example: '****4567',
    description: 'Operatorga to‘liq raqam ko‘rsatilishi EQ-02 qaroriga bog‘liq',
  })
  phoneMasked: string;

  @ApiProperty({ type: LeadProductRefDto }) product: LeadProductRefDto;
  @ApiProperty({ example: 1, description: 'Miqdor (OPR-4)' }) quantity: number;

  @ApiProperty({
    type: [LeadCardItemDto],
    description:
      'BE-34: saytdan buyurtma tovarlari; BE-45: operator qo‘shgan qo‘shimcha tovar bilan (bitta tovarli lidda bo‘sh). ' +
      'Ko‘p tovarda `price` — butun posilka jami',
  })
  items: LeadCardItemDto[];

  @ApiProperty({
    enum: ['CALL', 'SMS'],
    example: 'CALL',
    description:
      'BE-34: tasdiqlash usuli — SMS bo‘lsa mijozga havola ketgan, muddati o‘tgach operatorga',
  })
  confirmMode: 'CALL' | 'SMS';

  @ApiProperty({
    type: LeadAddressDto,
    nullable: true,
    description:
      'Sotuvchi sahifasi va sayt lidida doim bor. Bo‘sh faqat API lidida bo‘lishi mumkin (BE-43, EQ-04)',
  })
  address: LeadAddressDto | null;

  @ApiProperty({
    type: LeadPriceDto,
    nullable: true,
    description:
      'Joriy miqdor va yetkazish turi bo‘yicha server hisobi (FE-09). Bo‘sh — yetkazish turi hali yo‘q ' +
      '(faqat manzilsiz API lidi): avval PATCH leads/:id/address yoki POST leads/:id/quote',
  })
  price: LeadPriceDto | null;

  @ApiProperty({
    enum: LeadRejectReason,
    example: null,
    nullable: true,
    description: 'Shu lid rad etilgan bo‘lsa sababi',
  })
  rejectReason: LeadRejectReason | null;

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

  @ApiProperty({
    example: null,
    nullable: true,
    type: Number,
    description:
      'Qora ro‘yxat (TZ 7: bir raqam 2 marta rad etgan): necha marta rad etgani; bo‘sh — ro‘yxatda emas. ' +
      'Chora EQ-04 javobidan keyin (BE-35)',
  })
  blacklistRejections: number | null;

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

  /** BE-25 (FE-08): «15:00 Bobur — O‘ylab ko‘radi «Turmush o‘rtog‘i bilan maslahatlashadi»». */
  @ApiProperty({
    enum: LeadOutcome,
    nullable: true,
    example: LeadOutcome.THINKING,
    description: 'Oxirgi urinish natijasi; urinish yo‘q — null',
  })
  lastOutcome: LeadOutcome | null;

  @ApiProperty({
    nullable: true,
    type: String,
    example: 'Turmush o‘rtog‘i bilan maslahatlashadi',
    description: 'Oxirgi urinish izohi',
  })
  lastComment: string | null;

  @ApiProperty({
    nullable: true,
    type: String,
    example: '2026-12-01T10:20:00.000Z',
    description: 'Oxirgi urinish vaqti',
  })
  lastAttemptAt: string | null;
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
  @IsLeadBigintId('duplicateOfLeadId')
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
  @Transform(trimLeadText)
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  regionSoato: string;

  @ApiProperty({ example: '1726266' })
  @Transform(trimLeadText)
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  districtSoato: string;

  @ApiProperty({ example: 'Turkiston ko‘chasi, 27-uy' })
  @Transform(trimLeadText)
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

  @ApiProperty({
    example: '2026-12-01T09:31:00.000Z',
    nullable: true,
    type: String,
    description:
      'Shu holat boshlangan vaqt (FE-08: «Tanaffusdasiz · 6 daqiqa»); holat hali tanlanmagan — null',
  })
  since: string | null;

  @ApiProperty({
    example: false,
    description:
      'BE-15: «Qo‘ng‘iroq» tugmasi ishlaydi — telefoniya ulangan va operatorga telefon biriktirilgan. false — natija qo‘lda',
  })
  callEnabled: boolean;
}

/** Operator hozir nima qilmoqda (BE-25, FE-26 o‘tkazish oynasi): telefoniya holatidan. */
export enum OperatorActivityKind {
  CONNECTING = 'CONNECTING',
  RINGING = 'RINGING',
  IN_CALL = 'IN_CALL',
  /** Qo‘ng‘iroq tugagan, natija hali kiritilmagan. */
  WRAP_UP = 'WRAP_UP',
  IDLE = 'IDLE',
}

export class OperatorActivityDto {
  @ApiProperty({
    enum: OperatorActivityKind,
    example: OperatorActivityKind.IN_CALL,
  })
  kind: OperatorActivityKind;

  @ApiProperty({ example: '1246', nullable: true, type: String })
  leadId: string | null;

  @ApiProperty({
    example: '2027-01-14T09:35:48.000Z',
    nullable: true,
    type: String,
    description: 'Shu bosqich qachondan beri',
  })
  since: string | null;
}

export class OperatorQueueOperatorDto {
  @ApiProperty({ example: '41' }) operatorId: string;
  @ApiProperty({ example: 'Dilnoza R.' }) name: string;
  @ApiProperty({ enum: OperatorWorkState, example: OperatorWorkState.ONLINE })
  state: OperatorWorkState;

  @ApiProperty({ example: 2 }) activeBookings: number;

  @ApiProperty({ example: 5, description: 'Bron chegarasi (6-qoida)' })
  maxBookings: number;

  @ApiProperty({
    example: 1,
    description:
      'Mijoz aytgan vaqtdagi qo‘ng‘iroqlar (operatorda qoladi, bron chegarasiga kirmaydi)',
  })
  scheduledCalls: number;

  @ApiProperty({
    type: OperatorActivityDto,
    nullable: true,
    description: 'Telefoniya ulanmagan bo‘lsa — null',
  })
  activity: OperatorActivityDto | null;
}

/**
 * Navbat ko‘rinishi (BE-13). Sonlar umumiy: operator ish joyida (BE-25) ham — boshqa operatorga yozilgan, 15 daqiqalik
 * muhlati o‘tmagan qayta qo‘ng‘iroqlar ham kiradi, shuning uchun «Keyingi lid» baribir 404 `LEAD_QUEUE_EMPTY` berishi
 * mumkin.
 */
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
  @ApiProperty({
    example: 41,
    nullable: true,
    type: Number,
    description:
      'Tasdiq foizi: tasdiqlagan lidlar / shu davrda ishlagan yaroqli lidlar; maxraj 0 bo‘lsa bo‘sh',
  })
  approveRate: number | null;

  @ApiProperty({
    example: 78,
    nullable: true,
    type: Number,
    description:
      'Sotilish foizi: shu davrda tasdiqlaganlaridan yetkazilgan / (yetkazilgan + rad); maxraj 0 bo‘lsa bo‘sh',
  })
  saleRate: number | null;

  @ApiProperty({
    example: 4,
    nullable: true,
    type: Number,
    description: 'Birinchi qo‘ng‘iroqqacha median, daqiqa',
  })
  firstCallMedianMinutes: number | null;

  @ApiProperty({
    example: 15,
    nullable: true,
    type: Number,
    description:
      'BE-45 (OPR-7): upsell foizi — shu davrda tasdiqlaganlaridan qo‘shimcha tovarlilari / tasdiqlaganlari ' +
      '(TZ 9: «Qo‘shimcha tovarli buyurtmalar / barcha buyurtmalar»); maxraj 0 bo‘lsa bo‘sh',
  })
  upsellRate: number | null;

  @ApiProperty({
    example: 20000,
    description:
      'BE-45 TC6: upsell bonusi, so‘m — shu davrda mijoz olgan qo‘shimcha tovarlar uchun (har tovarga bitta, summa sozlamadan, ' +
      'qaytarilganlari ayirilgan). Ish haqi bilan to‘lanadi (TZ 2.5)',
  })
  upsellBonus: number;

  @ApiProperty({
    example: 2,
    description: 'Bonus olingan qo‘shimcha tovarlar soni',
  })
  upsellBonusCount: number;
}

/**
 * Holat yorliqlari (BE-25, FE-26): «Ishda» — Yangi, Bronda, Qayta qo‘ng‘iroq (tekshiruvdagilarsiz); «Yopilgan» —
 * Yaroqsiz, Dublikat, Aloqa bo‘lmadi; «Tekshiruvda» — navbatga tushmagan arizalar (BE-12), faqat admin.
 */
export enum AdminLeadTab {
  ALL = 'ALL',
  ACTIVE = 'ACTIVE',
  CONFIRMED = 'CONFIRMED',
  REJECTED = 'REJECTED',
  CLOSED = 'CLOSED',
  REVIEW = 'REVIEW',
}

export enum AdminLeadSort {
  CREATED_ASC = 'createdAt',
  CREATED_DESC = '-createdAt',
  PRICE_ASC = 'price',
  PRICE_DESC = '-price',
  ATTEMPTS_ASC = 'attempts',
  ATTEMPTS_DESC = '-attempts',
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** GET /admin/leads filtri (BE-42, FE-26); CSV eksport ham shu filtr bilan. */
export class AdminLeadFilterDto {
  @ApiPropertyOptional({ enum: AdminLeadTab })
  @IsOptional()
  @IsEnum(AdminLeadTab)
  tab?: AdminLeadTab;

  @ApiPropertyOptional({
    example: 'L-1284',
    maxLength: 100,
    description:
      'Lid raqami («L-1284» yoki 1284), mijoz ismi yoki sahifa kodi. Telefon bo‘yicha qidiruv yo‘q (134-savol)',
  })
  @IsOptional()
  @Transform(trimLeadText)
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ enum: LeadSource })
  @IsOptional()
  @IsEnum(LeadSource)
  source?: LeadSource;

  @ApiPropertyOptional({ enum: LeadStatus })
  @IsOptional()
  @IsEnum(LeadStatus)
  status?: LeadStatus;

  @ApiPropertyOptional({ example: '77', description: 'Sotuvchi ID si' })
  @IsOptional()
  @IsLeadBigintId('affiliateId')
  affiliateId?: string;

  @ApiPropertyOptional({ example: '501' })
  @IsOptional()
  @IsLeadBigintId('productId')
  productId?: string;

  @ApiPropertyOptional({ example: '41' })
  @IsOptional()
  @IsLeadBigintId('operatorId')
  operatorId?: string;

  @ApiPropertyOptional({ example: '2026-12-01', description: 'Toshkent kuni' })
  @IsOptional()
  @Matches(DAY, { message: 'from YYYY-MM-DD bo‘lishi kerak' })
  @IsDateString({ strict: true })
  from?: string;

  @ApiPropertyOptional({
    example: '2026-12-31',
    description: 'Toshkent kuni, shu kun ham kiradi',
  })
  @IsOptional()
  @Matches(DAY, { message: 'to YYYY-MM-DD bo‘lishi kerak' })
  @IsDateString({ strict: true })
  to?: string;
}

export class AdminLeadsQueryDto extends AdminLeadFilterDto {
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
    enum: AdminLeadSort,
    default: AdminLeadSort.CREATED_DESC,
  })
  @IsOptional()
  @IsEnum(AdminLeadSort)
  sort?: AdminLeadSort;
}

export class AdminLeadListItemDto {
  @ApiProperty({ example: '7001' }) id: string;
  @ApiProperty({ example: '2027-01-14T09:32:00.000Z' }) createdAt: Date;
  @ApiProperty({ enum: LeadStatus, example: LeadStatus.NEW })
  status: LeadStatus;

  @ApiProperty({ enum: LeadSource, example: LeadSource.LANDING })
  source: LeadSource;

  @ApiProperty({ example: 'Aziza' }) customerName: string;
  @ApiProperty({ example: '****4567' }) phoneMasked: string;
  @ApiProperty({ example: 'Simsiz quloqchinlar' }) productName: string;

  @ApiProperty({ example: 'Jasur T.', nullable: true, type: String })
  affiliateName: string | null;

  @ApiProperty({ example: null, nullable: true, type: String })
  operatorName: string | null;

  @ApiProperty({ example: null, nullable: true, type: String })
  orderId: string | null;

  // ── BE-25 (FE-26) ──
  @ApiProperty({ example: '501' }) productId: string;

  @ApiProperty({
    example: 'Toshkent shahri',
    nullable: true,
    type: String,
    description: 'Viloyat; manzilsiz API lidi yoki geo javob bermadi — null',
  })
  regionName: string | null;

  @ApiProperty({ example: 'k7m2qa', nullable: true, type: String })
  streamCode: string | null;

  @ApiProperty({ example: 262000, description: 'Sahifadagi narx, so‘m' })
  salePrice: number;

  @ApiProperty({ example: 2 }) attemptsCount: number;

  @ApiProperty({ example: '41', nullable: true, type: String })
  operatorId: string | null;

  @ApiProperty({
    enum: LeadRejectReason,
    example: null,
    nullable: true,
  })
  rejectReason: LeadRejectReason | null;

  @ApiProperty({
    example: 'Qimmat',
    nullable: true,
    type: String,
    description:
      'Yopilgan lid sababi: rad sababi, «→ L-1163 · asosiy lid», «6 urinish · 13.01, 10:01»',
  })
  closedNote: string | null;

  @ApiProperty({
    example: '2027-01-14T08:02:00.000Z',
    nullable: true,
    type: String,
    description: 'Faqat «Rad etildi» holatida',
  })
  rejectedAt: string | null;

  @ApiProperty({
    example: '2027-01-14T10:20:00.000Z',
    nullable: true,
    type: String,
    description: 'Mijoz aytgan qayta qo‘ng‘iroq vaqti',
  })
  callbackAt: string | null;

  @ApiProperty({
    example: 8,
    nullable: true,
    type: Number,
    description: 'Umumiy navbatdagi o‘rni (7-qoida); navbatda emas — null',
  })
  queuePosition: number | null;

  @ApiProperty({
    example: '2027-01-14T09:38:00.000Z',
    description: 'Holat oxirgi o‘zgargan vaqt (o‘zgarmagan — kelgan vaqti)',
  })
  statusAt: string;

  @ApiProperty({
    example: false,
    description: 'Tekshiruvda — navbatga tushmagan (BE-12)',
  })
  inReview: boolean;

  @ApiProperty({
    example: null,
    nullable: true,
    type: String,
    description: 'IP: faqat admin va faqat tekshiruvdagi arizada',
  })
  ip: string | null;

  @ApiProperty({
    example: null,
    nullable: true,
    type: String,
    description: 'Qurilma: faqat admin va faqat tekshiruvdagi arizada',
  })
  device: string | null;
}

/**
 * Yorliqlardagi sonlar: filtrlar bo‘yicha, `tab` va `status` siz. «Hammasi» ga tekshiruvdagi arizalar kirmaydi
 * (dizayn p-a6: ALL = ACTIVE + CONFIRMED + REJECTED + CLOSED).
 */
export class AdminLeadCountsDto {
  @ApiProperty({ example: 128 }) ALL: number;
  @ApiProperty({ example: 42 }) ACTIVE: number;
  @ApiProperty({ example: 51 }) CONFIRMED: number;
  @ApiProperty({ example: 19 }) REJECTED: number;
  @ApiProperty({ example: 9 }) CLOSED: number;

  @ApiPropertyOptional({ example: 7, description: 'Faqat admin' })
  REVIEW?: number;
}

/** «7 ta ariza tekshiruvda — navbatga tushmagan» banneri: eng ko‘p ariza turgan sahifa. */
export class AdminLeadReviewBannerDto {
  @ApiProperty({ example: 7, description: 'Shu sahifadagi arizalar' })
  count: number;
  @ApiProperty({ example: 'k7m2qa' }) streamCode: string;
  @ApiProperty({ example: 'Jasur T.' }) affiliateName: string;
  @ApiProperty({ example: '2027-01-14T09:20:00.000Z' }) from: string;
  @ApiProperty({ example: '2027-01-14T09:29:00.000Z' }) to: string;
}

export class AdminLeadsPageDto {
  @ApiProperty({ type: [AdminLeadListItemDto] }) items: AdminLeadListItemDto[];
  @ApiProperty({ type: AdminLeadCountsDto }) counts: AdminLeadCountsDto;

  @ApiProperty({
    type: AdminLeadReviewBannerDto,
    nullable: true,
    description: 'Faqat admin; tekshiruvda sahifadan kelgan ariza yo‘q — null',
  })
  review: AdminLeadReviewBannerDto | null;

  @ApiProperty({ example: 42 }) total: number;
  @ApiProperty({ example: 1 }) page: number;
  @ApiProperty({ example: 20 }) limit: number;
  @ApiProperty({ example: 3 }) totalPages: number;
}

/** BE-25 (FE-08 «Mahsulot ma’lumoti» paneli): GET /operator/leads/:id/product. */
export class OperatorLeadProductDto {
  @ApiProperty({ example: '501' }) id: string;
  @ApiProperty({ example: 'Simsiz quloqchinlar' }) name: string;
  @ApiProperty({ example: 'Elektronika', nullable: true, type: String })
  category: string | null;

  @ApiProperty({ example: null, nullable: true, type: String })
  imageUrl: string | null;

  @ApiProperty({
    example: 'Kundalik foydalanish uchun simsiz quloqchinlar',
    nullable: true,
    type: String,
  })
  description: string | null;

  @ApiProperty({
    type: [String],
    example: ['Telefonga Bluetooth orqali ulanadi'],
    description: 'Offer matnlaridagi afzalliklar (admin kiritadi, BE-11)',
  })
  highlights: string[];

  @ApiProperty({
    example: 120,
    nullable: true,
    type: Number,
    description:
      'Omborda sotuvga bor (band qilinmagan) dona; null — ombor javob bermadi',
  })
  available: number | null;

  @ApiProperty({ example: 0.3, nullable: true, type: Number })
  weightKg: number | null;

  @ApiProperty({
    example: 'quloqchinlar (juft), g‘ilof, kabel',
    nullable: true,
    type: String,
    description: 'Qutida nima bor (offer matnlari)',
  })
  contents: string | null;

  @ApiProperty({ example: 262000, description: 'Lid sahifasidagi narx, so‘m' })
  salePrice: number;

  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'number' },
    example: { CENTER: 30000, ADDRESS: 50000 },
    nullable: true,
    description:
      '1 dona uchun ikki yetkazish turi narxi, so‘m; katalog javob bermasa null',
  })
  deliveryFee: Record<CheckoutDeliveryDestination, number> | null;

  @ApiProperty({
    example: 'https://elchi.uz/p3v9tx',
    nullable: true,
    type: String,
    description: 'Mijoz ko‘rgan sotuvchi sahifasi; API va sayt lidida null',
  })
  pageUrl: string | null;

  @ApiProperty({
    example: null,
    nullable: true,
    type: String,
    description:
      'Operator aytishi shart bo‘lgan ogohlantirish: BAD — «Dori vositasi emas» (8-bo‘lim); bo‘lmasa null',
  })
  warning: string | null;
}

/** BE-25 (FE-08): GET /operator/attempts — bugungi urinishlarim. */
export class OperatorAttemptsQueryDto {
  @ApiPropertyOptional({
    example: '2026-12-01',
    description: 'Toshkent sanasi; sukut — bugun',
  })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({
    example: '2026-12-01',
    description: 'Toshkent sanasi; sukut — from',
  })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ example: 10, minimum: 1, maximum: 100, default: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class OperatorAttemptItemDto {
  @ApiProperty({ example: '2026-12-01T09:33:00.000Z' }) at: string;
  @ApiProperty({ example: '7001' }) leadId: string;
  @ApiProperty({ example: 'Dildora' }) customerName: string;
  @ApiProperty({ example: 'Oshxona tarozisi' }) productName: string;
  @ApiProperty({ enum: LeadOutcome, example: LeadOutcome.REJECTED })
  outcome: LeadOutcome;

  @ApiProperty({ example: null, nullable: true, type: String })
  comment: string | null;

  @ApiProperty({
    enum: LeadRejectReason,
    nullable: true,
    example: LeadRejectReason.NOT_NEEDED,
    description: 'Faqat REJECTED urinishida',
  })
  rejectReason: LeadRejectReason | null;

  @ApiProperty({
    example: null,
    nullable: true,
    type: String,
    description:
      'Keyingi qo‘ng‘iroq vaqti («Keyinroq qiling · ertaga 14:00», «Javob bermadi · 14:31»)',
  })
  nextAttemptAt: string | null;

  @ApiProperty({
    example: null,
    nullable: true,
    type: Number,
    description:
      'Suhbat davomiyligi (BE-15); suhbat bo‘lmagan yoki telefoniya ulanmagan — null',
  })
  durationSeconds: number | null;

  @ApiPropertyOptional({
    type: () => LeadAttemptCallDto,
    nullable: true,
    description: 'BE-15: urinishdagi qo‘ng‘iroq; qo‘ng‘iroqsiz — null',
  })
  call?: LeadAttemptCallDto | null;
}

export class OperatorAttemptsPageDto {
  @ApiProperty({ type: [OperatorAttemptItemDto] })
  items: OperatorAttemptItemDto[];

  @ApiProperty({
    example: 38,
    description:
      'Davrdagi jami urinishlar — GET /operator/stats `attempts` bilan bir xil',
  })
  total: number;
}
