import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { IsLeadBigintId, LeadStatus, StreamTemplate } from './lead.dto';

// Lid-sotuv: sotuvchi (AFFILIATE) kabineti — offerlar, sotuvchi sahifalari, statistika (BE-25 shartnomasi).
// Real kod: BE-11 (offer va sahifa), BE-28 (statistika). Rol AFFILIATE BE-05 da qo‘shiladi.
// Qoidalar: S1/S3 varianti, mijoz manzili va to‘liq telefon sotuvchiga qaytmaydi;
// postback siri va CAPI tokeni faqat yoziladi, javobda qaytmaydi (BE-11).

/** Sotuvchi sahifasining sotuvchi kabinetidagi holati [taklif]. */
export enum AffiliateStreamStatus {
  ACTIVE = 'ACTIVE',
  STOPPED = 'STOPPED',
}

/** Offerlar ro‘yxatini saralash [taklif] (SOT-2: haq, EPC, tasdiq foizi). */
export enum AffiliateOfferSort {
  NEWEST = 'NEWEST',
  FEE = 'FEE',
  EPC = 'EPC',
  APPROVE_RATE = 'APPROVE_RATE',
}

/** Kreativ turi (SOT-9: har offer uchun video va foto; yuklash BE-08). */
export enum AffiliateCreativeType {
  IMAGE = 'IMAGE',
  VIDEO = 'VIDEO',
}

/**
 * Lid bo‘yicha sotuvchi haqining holati — CSV «Haq holati» ustuni (hujjat-statistika-csv, h-4.md):
 * Kutilmoqda, Ushlab turilgan, Mavjud, Teskari yozildi, Yozilmaydi. Nomlar [taklif].
 */
export enum AffiliateCommissionState {
  PENDING = 'PENDING',
  HOLD = 'HOLD',
  AVAILABLE = 'AVAILABLE',
  REVERSED = 'REVERSED',
  NONE = 'NONE',
}

/** Statistika guruhlash: kun, sotuvchi sahifasi, sub1 (SOT-4, BE-28). */
export enum AffiliateStatsGroupBy {
  DAY = 'DAY',
  STREAM = 'STREAM',
  SUB1 = 'SUB1',
}

export class AffiliatePageQueryDto {
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
}

export class AffiliateOffersQueryDto extends AffiliatePageQueryDto {
  @ApiPropertyOptional({ example: 'quloqchin' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ example: '12' })
  @IsOptional()
  @IsLeadBigintId('categoryId')
  categoryId?: string;

  @ApiPropertyOptional({
    example: 50,
    minimum: 0,
    maximum: 100,
    description: 'Tasdiq foizi kamida shuncha (FE-05 TC5 «tasdiq ≥ 50%»)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  minApproveRate?: number;

  @ApiPropertyOptional({
    enum: AffiliateOfferSort,
    default: AffiliateOfferSort.NEWEST,
  })
  @IsOptional()
  @IsEnum(AffiliateOfferSort)
  sort?: AffiliateOfferSort;
}

export class AffiliateCreativeDto {
  @ApiProperty({ example: '9001' }) id: string;
  @ApiProperty({
    enum: AffiliateCreativeType,
    example: AffiliateCreativeType.VIDEO,
  })
  type: AffiliateCreativeType;

  @ApiProperty({ example: 'https://cdn.example.uz/creatives/9001.mp4' })
  url: string;
}

/** Offer — sotuvga chiqarilgan mahsulot (SOT-2). */
export class AffiliateOfferDto {
  @ApiProperty({ example: '501' }) productId: string;
  @ApiProperty({ example: 'Simsiz quloqchinlar' }) name: string;

  @ApiProperty({ example: null, nullable: true, type: String })
  imageUrl: string | null;

  @ApiProperty({ example: 251000, description: 'Tasdiqlangan narx, so‘m' })
  approvedPrice: number;

  @ApiProperty({
    example: 276000,
    description: 'Sahifadagi eng katta narx: tasdiqlangan narx + 10% (NRX-4)',
  })
  maxSalePrice: number;

  @ApiProperty({ example: 65000, description: 'Sotuvchi haqi, so‘m' })
  affiliateFee: number;

  @ApiProperty({
    example: null,
    nullable: true,
    type: Number,
    description:
      'EPC, so‘m: daromad / klik. Bo‘sh — statistika yo‘q (daromad BE-22, BE-28 dan keyin)',
  })
  epc: number | null;

  @ApiProperty({
    example: 41,
    nullable: true,
    type: Number,
    description:
      'Tasdiq foizi: tasdiqlangan / yaroqli lidlar (hamma sotuvchilar). Bo‘sh — lid yo‘q',
  })
  approveRate: number | null;

  @ApiProperty({
    example: null,
    nullable: true,
    type: Number,
    description:
      'Sotilish foizi: mijoz olgan / jo‘natilgan buyurtmalar (TZ 1-bo‘lim «Sotilish foizi (jo‘natilgandan)»). Bo‘sh — statistika yo‘q (BE-21, BE-28 dan keyin)',
  })
  saleRate: number | null;

  @ApiProperty({ example: 120 }) stock: number;
  @ApiProperty({ example: true }) hasVideo: boolean;

  @ApiProperty({
    type: [AffiliateCreativeDto],
    description:
      'Admin yuklagan kreativlar: rasm va video (SOT-9, FE-12); sotuvchi yuklab oladi',
  })
  creatives: AffiliateCreativeDto[];
}

export class AffiliateOffersPageDto {
  @ApiProperty({ type: [AffiliateOfferDto] }) items: AffiliateOfferDto[];
  @ApiProperty({ example: 42 }) total: number;
  @ApiProperty({ example: 1 }) page: number;
  @ApiProperty({ example: 20 }) limit: number;
  @ApiProperty({ example: 3 }) totalPages: number;
}

/** POST /affiliate/streams — «Sahifa yaratish»: faqat offer ID (BE-11 TC1). */
export class CreateAffiliateStreamDto {
  @ApiProperty({ example: '501' })
  @IsLeadBigintId('productId')
  productId: string;
}

/** PATCH /affiliate/streams/:id — sozlamalar ixtiyoriy (BE-11). */
export class UpdateAffiliateStreamBodyDto {
  @ApiPropertyOptional({ enum: StreamTemplate })
  @IsEnum(StreamTemplate)
  template: StreamTemplate;

  @ApiPropertyOptional({
    example: 276000,
    description: 'Tasdiqlangan narxdan +10% gacha, kam emas',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  salePrice: number;

  @ApiPropertyOptional() @IsString() @MaxLength(255) sub1: string;
  @ApiPropertyOptional() @IsString() @MaxLength(255) sub2: string;
  @ApiPropertyOptional() @IsString() @MaxLength(255) sub3: string;
  @ApiPropertyOptional() @IsString() @MaxLength(255) sub4: string;
  @ApiPropertyOptional() @IsString() @MaxLength(255) sub5: string;

  @ApiPropertyOptional({
    example: '1234567890',
    description: 'Faqat raqamlar; bo‘sh satr — o‘chirish',
  })
  @IsString()
  @MaxLength(64)
  @Matches(/^\d*$/, { message: 'metaPixelId faqat raqamlardan iborat bo‘ladi' })
  metaPixelId: string;

  @ApiPropertyOptional({
    description: 'Lotin harflari va raqamlar; bo‘sh satr — o‘chirish',
  })
  @IsString()
  @MaxLength(64)
  @Matches(/^[A-Za-z0-9]*$/, {
    message: 'tiktokPixelId faqat lotin harflari va raqamlardan iborat bo‘ladi',
  })
  tiktokPixelId: string;

  @ApiPropertyOptional({
    description:
      'Postback URL (BE-14). Makrolar: {status} (lead, confirmed, rejected, delivered), {lead_id}, {click_id}, ' +
      '{product_id}, {sub1}…{sub5} [taklif]. Ichki tarmoq manzili rad etiladi (SSRF). Siri berilsa so‘rov ' +
      'X-Elchi-Timestamp va X-Elchi-Signature (sha256 HMAC) bilan imzolanadi',
  })
  @IsUrl({ require_protocol: true })
  @MaxLength(2048)
  postbackUrl: string;

  @ApiPropertyOptional({ description: 'Faqat yoziladi, javobda qaytmaydi' })
  @IsString()
  @MaxLength(255)
  postbackSecret: string;

  @ApiPropertyOptional({
    description: 'Meta CAPI tokeni: faqat yoziladi (yuborish BE-31 da)',
  })
  @IsString()
  @MaxLength(512)
  capiToken: string;
}

export class UpdateAffiliateStreamDto extends PartialType(
  UpdateAffiliateStreamBodyDto,
) {}

export class AffiliateStreamDto {
  @ApiProperty({ example: '3301' }) id: string;
  @ApiProperty({ example: 'k7Qm2x' }) code: string;

  @ApiProperty({
    example: 'https://[sotuvchi-sahifasi-domeni]/k7Qm2x',
    description: 'Tayyor havola; domen EQ-05 da',
  })
  link: string;

  @ApiProperty({ example: '501' }) productId: string;
  @ApiProperty({ example: 'Simsiz quloqchinlar' }) productName: string;
  @ApiProperty({ enum: StreamTemplate, example: StreamTemplate.STANDART })
  template: StreamTemplate;

  @ApiProperty({ example: 262000 }) salePrice: number;
  @ApiProperty({
    enum: AffiliateStreamStatus,
    example: AffiliateStreamStatus.ACTIVE,
  })
  status: AffiliateStreamStatus;

  @ApiProperty({ example: null, nullable: true, type: String })
  sub1: string | null;

  @ApiProperty({ example: null, nullable: true, type: String })
  sub2: string | null;

  @ApiProperty({ example: null, nullable: true, type: String })
  sub3: string | null;

  @ApiProperty({ example: null, nullable: true, type: String })
  sub4: string | null;

  @ApiProperty({ example: null, nullable: true, type: String })
  sub5: string | null;

  @ApiProperty({ example: '1234567890', nullable: true, type: String })
  metaPixelId: string | null;

  @ApiProperty({ example: null, nullable: true, type: String })
  tiktokPixelId: string | null;

  @ApiProperty({ example: null, nullable: true, type: String })
  postbackUrl: string | null;

  @ApiProperty({ example: false, description: 'Postback siri saqlanganmi' })
  hasPostbackSecret: boolean;

  @ApiProperty({ example: false, description: 'CAPI tokeni saqlanganmi' })
  hasCapiToken: boolean;

  @ApiProperty({ example: 1240 }) clicks: number;
  @ApiProperty({ example: 37 }) leads: number;
  @ApiProperty({
    example: null,
    nullable: true,
    type: Number,
    description:
      'Yetkazilgan buyurtmalar; bo‘sh — statistika hali yo‘q (BE-28)',
  })
  sales: number | null;
  @ApiProperty({ example: '2026-11-18T09:12:00.000Z' }) createdAt: Date;
}

export class AffiliateStreamsPageDto {
  @ApiProperty({ type: [AffiliateStreamDto] }) items: AffiliateStreamDto[];
  @ApiProperty({ example: 2 }) total: number;
  @ApiProperty({ example: 1 }) page: number;
  @ApiProperty({ example: 20 }) limit: number;
  @ApiProperty({ example: 1 }) totalPages: number;
}

export class AffiliateStatsQueryDto {
  @ApiProperty({ example: '2026-12-01', description: 'Toshkent sanasi' })
  @IsDateString()
  from: string;

  @ApiProperty({ example: '2026-12-31', description: 'Toshkent sanasi' })
  @IsDateString()
  to: string;

  @ApiPropertyOptional({
    enum: AffiliateStatsGroupBy,
    default: AffiliateStatsGroupBy.DAY,
  })
  @IsOptional()
  @IsEnum(AffiliateStatsGroupBy)
  groupBy?: AffiliateStatsGroupBy;

  @ApiPropertyOptional({ example: '3301' })
  @IsOptional()
  @IsLeadBigintId('streamId')
  streamId?: string;
}

/** Statistika qatori (SOT-4). Variant, manzil va telefon yo‘q. */
export class AffiliateStatsRowDto {
  @ApiProperty({
    example: '2026-12-01',
    description: 'Guruh kaliti: sana, sahifa kodi yoki sub1 qiymati',
  })
  key: string;

  @ApiProperty({ example: 410 }) clicks: number;
  @ApiProperty({ example: 14 }) leads: number;
  @ApiProperty({ example: 12 }) validLeads: number;
  @ApiProperty({ example: 6 }) confirmed: number;
  @ApiProperty({ example: 4 }) delivered: number;
  @ApiProperty({ example: 1 }) refused: number;

  @ApiProperty({ example: 130000, description: 'HOLD daromad, so‘m' })
  incomeHold: number;

  @ApiProperty({ example: 65000, description: 'AVAILABLE daromad, so‘m' })
  incomeAvailable: number;
}

export class AffiliateStatsDto {
  @ApiProperty({ type: [AffiliateStatsRowDto] }) rows: AffiliateStatsRowDto[];
  @ApiProperty({ type: AffiliateStatsRowDto }) totals: AffiliateStatsRowDto;
}

/** GET /affiliate/leads — lidlar ro‘yxati va CSV manbasi (BE-28, FE-06 TC2; CSV ni FE-02 umumiy yuklab olishi yig‘adi). */
export class AffiliateLeadsQueryDto extends AffiliatePageQueryDto {
  @ApiProperty({ example: '2027-01-08', description: 'Toshkent sanasi' })
  @IsDateString()
  from: string;

  @ApiProperty({ example: '2027-01-14', description: 'Toshkent sanasi' })
  @IsDateString()
  to: string;

  @ApiPropertyOptional({ example: '3301' })
  @IsOptional()
  @IsLeadBigintId('streamId')
  streamId?: string;

  @ApiPropertyOptional({ enum: LeadStatus })
  @IsOptional()
  @IsEnum(LeadStatus)
  status?: LeadStatus;
}

/**
 * Bitta lid — sotuvchi ko‘rinishi (SOT-4; hujjat-statistika-csv ustunlari A–I).
 * Ism, manzil, to‘liq raqam va S1/S3 varianti yo‘q (BE-28 accept).
 */
export class AffiliateLeadRowDto {
  @ApiProperty({ example: '7001' }) id: string;
  @ApiProperty({ example: '2027-01-14T09:32:00.000Z' }) createdAt: Date;
  @ApiProperty({ example: 'k7Qm2x', description: 'Sotuvchi sahifasi kodi' })
  streamCode: string;

  @ApiProperty({ example: 'kampaniya-1', nullable: true, type: String })
  sub1: string | null;

  @ApiProperty({ example: null, nullable: true, type: String })
  sub2: string | null;

  @ApiProperty({ example: null, nullable: true, type: String })
  sub3: string | null;

  @ApiProperty({ example: null, nullable: true, type: String })
  sub4: string | null;

  @ApiProperty({ example: null, nullable: true, type: String })
  sub5: string | null;

  @ApiProperty({
    example: '****4567',
    description: 'Faqat oxirgi 4 raqam (SOT-4)',
  })
  phoneLast4: string;

  @ApiProperty({ enum: LeadStatus, example: LeadStatus.CONFIRMED })
  status: LeadStatus;

  @ApiProperty({
    example: null,
    nullable: true,
    type: String,
    description: 'Buyurtma holati; buyurtma bo‘lmasa bo‘sh',
  })
  orderStatus: string | null;

  @ApiProperty({
    example: 65000,
    nullable: true,
    type: Number,
    description: 'Sotuvchi haqi, so‘m; haq yo‘q bo‘lsa bo‘sh',
  })
  commission: number | null;

  @ApiProperty({
    enum: AffiliateCommissionState,
    example: AffiliateCommissionState.HOLD,
    nullable: true,
    description:
      'Bo‘sh — lid hali ishlanmoqda, haq haqida gap yo‘q (CSV da bo‘sh katak); NONE — «Yozilmaydi»',
  })
  commissionState: AffiliateCommissionState | null;
}

export class AffiliateLeadsPageDto {
  @ApiProperty({ type: [AffiliateLeadRowDto] }) items: AffiliateLeadRowDto[];
  @ApiProperty({ example: 60 }) total: number;
  @ApiProperty({ example: 1 }) page: number;
  @ApiProperty({ example: 20 }) limit: number;
  @ApiProperty({ example: 3 }) totalPages: number;
}

/** GET/PUT /admin/offer-content/:productId — offer matnlari: suhbat skripti, afzalliklar, qutida (BE-11, FE-12; ega qarori 2026-11-17). */
export class OfferContentDto {
  @ApiProperty({ example: '501' }) productId: string;

  @ApiProperty({
    example:
      'Assalomu alaykum! Simsiz quloqchin buyurtmangiz bo‘yicha qo‘ng‘iroq qilyapman…',
    nullable: true,
    type: String,
    description: 'Suhbat skripti — operator lid kartasida ko‘radi (OPR-2)',
  })
  callScript: string | null;

  @ApiProperty({
    type: [String],
    example: ['Telefonga Bluetooth orqali ulanadi'],
    description: 'Afzalliklar — sotuvchi sahifasidagi «… haqida» bloki',
  })
  highlights: string[];

  @ApiProperty({
    type: [String],
    example: ['Quloqchinlar (juft)', 'Quvvatlovchi g‘ilof', 'Quvvat kabeli'],
    description: 'Qutida — sotuvchi sahifasidagi «Qutida» bloki',
  })
  boxContents: string[];

  @ApiProperty({ example: null, nullable: true, type: String })
  updatedAt: string | null;
}

export class UpdateOfferContentDto {
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  callScript?: string | null;

  @ApiProperty({ type: [String], maxItems: 10 })
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  highlights: string[];

  @ApiProperty({ type: [String], maxItems: 20 })
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  boxContents: string[];
}

/** Postback hodisasi (SOT-5: lid, tasdiq, yetkazildi, rad). Nomlar [taklif]. */
export enum AffiliatePostbackEvent {
  LEAD = 'lead',
  CONFIRMED = 'confirmed',
  REJECTED = 'rejected',
  DELIVERED = 'delivered',
}

export enum AffiliatePostbackStatus {
  PENDING = 'PENDING',
  SENT = 'SENT',
  FAILED = 'FAILED',
}

export class AffiliatePostbacksQueryDto extends AffiliatePageQueryDto {
  @ApiPropertyOptional({ example: '3301' })
  @IsOptional()
  @IsLeadBigintId('streamId')
  streamId?: string;
}

/** Yuborilganlar jurnali (BE-14: «Yuborilganlar jurnali sotuvchiga ko‘rinadi»). */
export class AffiliatePostbackDto {
  @ApiProperty({ example: '501' }) id: string;
  @ApiProperty({ example: '7001' }) leadId: string;
  @ApiProperty({ example: 'k7Qm2x' }) streamCode: string;
  @ApiProperty({
    enum: AffiliatePostbackEvent,
    example: AffiliatePostbackEvent.CONFIRMED,
  })
  event: AffiliatePostbackEvent;

  @ApiProperty({
    enum: AffiliatePostbackStatus,
    example: AffiliatePostbackStatus.SENT,
  })
  status: AffiliatePostbackStatus;

  @ApiProperty({ example: 1 }) attempts: number;

  @ApiProperty({ example: 200, nullable: true, type: Number })
  responseCode: number | null;

  @ApiProperty({
    example: '2027-01-14T09:40:00.000Z',
    nullable: true,
    type: String,
  })
  deliveredAt: string | null;

  @ApiProperty({ example: null, nullable: true, type: String })
  nextAttemptAt: string | null;

  @ApiProperty({ example: '2027-01-14T09:39:58.000Z' }) createdAt: Date;
}

export class AffiliatePostbacksPageDto {
  @ApiProperty({ type: [AffiliatePostbackDto] }) items: AffiliatePostbackDto[];
  @ApiProperty({ example: 12 }) total: number;
  @ApiProperty({ example: 1 }) page: number;
  @ApiProperty({ example: 20 }) limit: number;
  @ApiProperty({ example: 1 }) totalPages: number;
}
