import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { AffiliatePostbackStatus } from './lead-affiliate.dto';
import { IsLeadBigintId, LeadStatus, trimLeadText } from './lead.dto';
import {
  AdminLeadFilterDto,
  LeadCardDto,
  OperatorWorkState,
} from './lead-operator.dto';

// BE-25 (FE-26): admin va nazoratchi lid kartasi, filtr variantlari, bronni bo‘shatish, CSV eksport.

/** Kimga ko‘rsatiladi: IP, qurilma va sub faqat admin va superadminga [taklif]. */
export interface AdminLeadViewer {
  admin: boolean;
}

export class AdminLeadOperatorDto {
  @ApiProperty({ example: '41' }) id: string;
  @ApiProperty({ example: 'Dilnoza R.' }) name: string;
  @ApiProperty({ enum: OperatorWorkState, example: OperatorWorkState.ONLINE })
  state: OperatorWorkState;

  @ApiProperty({
    example: '2027-01-14T08:15:00.000Z',
    nullable: true,
    type: String,
  })
  since: string | null;

  @ApiProperty({ example: true }) inCall: boolean;

  @ApiProperty({
    example: '2027-01-14T09:36:30.000Z',
    nullable: true,
    type: String,
  })
  callStartedAt: string | null;
}

export class AdminLeadActorDto {
  @ApiProperty({ example: 'Shohruh M.' }) name: string;
  @ApiProperty({ example: '2027-01-14T08:02:00.000Z' }) at: string;
}

export class AdminLeadReopenedDto {
  @ApiProperty({ example: '2027-01-14T09:39:00.000Z' }) at: string;
  @ApiProperty({ example: 'Nodira K.' }) by: string;
  @ApiProperty({ example: 'Mijoz qayta qo‘ng‘iroq qildi' }) reason: string;
}

export class AdminLeadDeliveryOptionsDto {
  @ApiProperty({ example: 30000 }) CENTER: number;
  @ApiProperty({ example: 45000 }) ADDRESS: number;
}

export class AdminLeadProductInfoDto {
  @ApiProperty({ example: 'Elektronika', nullable: true, type: String })
  category: string | null;

  @ApiProperty({ example: 300, nullable: true, type: Number })
  weightGrams: number | null;

  @ApiProperty({ example: 'PARTIAL', nullable: true, type: String })
  deliveryMode: string | null;

  @ApiProperty({ type: AdminLeadDeliveryOptionsDto, nullable: true })
  options: AdminLeadDeliveryOptionsDto | null;
}

export class AdminLeadStreamDto {
  @ApiProperty({ example: 'k7m2qa' }) code: string;
  @ApiProperty({ example: 'Simsiz quloqchinlar' }) productName: string;
  @ApiProperty({ example: '2027-01-07T05:10:00.000Z' }) createdAt: string;
  @ApiProperty({ example: 'Jasur T.' }) affiliateName: string;
  @ApiProperty({ example: '77' }) affiliateId: string;

  @ApiProperty({ example: 'fb-reels-1', nullable: true, type: String })
  sub1: string | null;

  @ApiProperty({
    example: 'sub2=kampaniya · sub3=kreativ-4',
    nullable: true,
    type: String,
    description: 'sub2–sub5, to‘ldirilganlari',
  })
  subs: string | null;

  @ApiProperty({ example: 'facebook', nullable: true, type: String })
  utmSource: string | null;

  @ApiProperty({ example: true, description: 'fbclid kelganmi' })
  fbclid: boolean;

  @ApiProperty({
    example: '198.51.100.23',
    nullable: true,
    type: String,
    description: 'Faqat admin',
  })
  ip: string | null;

  @ApiProperty({
    example: 'Android · Chrome',
    nullable: true,
    type: String,
    description: 'Faqat admin; user agent dan',
  })
  device: string | null;
}

export class AdminLeadPostbackDto {
  @ApiProperty({ example: '2027-01-14T09:38:30.000Z' }) at: string;
  @ApiProperty({ example: 'confirmed' }) event: string;
  @ApiProperty({ example: 1 }) attempt: number;
  @ApiProperty({ example: 200, nullable: true, type: Number })
  code: number | null;

  @ApiProperty({
    enum: AffiliatePostbackStatus,
    example: AffiliatePostbackStatus.SENT,
  })
  state: AffiliatePostbackStatus;
}

export class AdminLeadMergedIntoDto {
  @ApiProperty({ example: '1163' }) id: string;
  @ApiProperty({ example: 'Simsiz quloqchinlar' }) productName: string;
  @ApiProperty({ enum: LeadStatus, example: LeadStatus.BOOKED })
  status: LeadStatus;

  @ApiProperty({ example: '2027-01-12T06:40:00.000Z' }) createdAt: string;
  @ApiProperty({ example: 'p4x9zt', nullable: true, type: String })
  streamCode: string | null;

  @ApiProperty({ example: 'Madina Q.', nullable: true, type: String })
  affiliateName: string | null;

  @ApiProperty({ example: 'Dilnoza R.', nullable: true, type: String })
  operatorName: string | null;

  @ApiProperty({ example: 3 }) attemptsCount: number;
}

export class AdminLeadOrderDto {
  @ApiProperty({ example: '9001' }) id: string;
  @ApiProperty({ example: 'CONFIRMED' }) status: string;
  @ApiProperty({ example: '2027-01-14T09:38:20.000Z' }) createdAt: string;
  @ApiProperty({ example: 292000 }) totalAmount: number;
}

/** `GET /admin/leads/{id}`: operator kartasi + admin bloklari. Telefon niqoblangan (134-savol). */
export class AdminLeadCardDto extends LeadCardDto {
  @ApiProperty({
    type: AdminLeadOperatorDto,
    nullable: true,
    description: 'Lid kimda; operatorda bo‘lmasa — null',
  })
  operator: AdminLeadOperatorDto | null;

  @ApiProperty({
    example: '2027-01-14T09:36:00.000Z',
    nullable: true,
    type: String,
    description: 'Bron boshlangan vaqt (faqat «Bronda»)',
  })
  bookedAt: string | null;

  @ApiProperty({ example: null, nullable: true, type: Number })
  queuePosition: number | null;

  @ApiProperty({
    example: '2027-01-17T09:32:00.000Z',
    nullable: true,
    type: String,
    description:
      'Avtomatik yopilish vaqti (2-qoida: 3 kun). Mijoz aytgan qo‘ng‘iroq va hali qo‘ng‘iroq qilinmagan lid o‘zi yopilmaydi — null',
  })
  closesAt: string | null;

  @ApiProperty({ example: null, nullable: true, type: String })
  rejectedAt: string | null;

  @ApiProperty({
    example: '2027-01-14T09:32:00.000Z',
    nullable: true,
    type: String,
    description: 'Mijoz rozilik bergan vaqt',
  })
  consentAt: string | null;

  @ApiProperty({
    type: AdminLeadActorDto,
    nullable: true,
    description: 'Rad etgan yoki yopgan; tizim yopgan bo‘lsa ism «Tizim»',
  })
  closedBy: AdminLeadActorDto | null;

  @ApiProperty({
    example: 2,
    description: 'Shu raqamdan boshqa lidlar (dublikatlar bilan)',
  })
  sameNumberLeads: number;

  @ApiProperty({ example: 'Jasur T.', nullable: true, type: String })
  affiliateName: string | null;

  @ApiProperty({ type: AdminLeadProductInfoDto, nullable: true })
  productInfo: AdminLeadProductInfoDto | null;

  @ApiProperty({
    type: AdminLeadStreamDto,
    nullable: true,
    description: 'Sahifadan kelgan lidda; sayt va API lidida — null',
  })
  stream: AdminLeadStreamDto | null;

  @ApiProperty({
    type: [AdminLeadPostbackDto],
    description: 'Sotuvchi trekeriga xabarlar; sozlanmagan — bo‘sh',
  })
  postbacks: AdminLeadPostbackDto[];

  @ApiProperty({ type: AdminLeadMergedIntoDto, nullable: true })
  mergedInto: AdminLeadMergedIntoDto | null;

  @ApiProperty({ type: AdminLeadReopenedDto, nullable: true })
  reopened: AdminLeadReopenedDto | null;

  @ApiProperty({
    type: AdminLeadOrderDto,
    nullable: true,
    description: 'Buyurtmasi bor lidda; checkout javob bermasa — null',
  })
  order: AdminLeadOrderDto | null;
}

export class LeadFilterOptionDto {
  @ApiProperty({ example: '501' }) id: string;
  @ApiProperty({ example: 'Simsiz quloqchinlar' }) name: string;
}

/** `GET /admin/leads/filter-options`: lidlarda uchragan mahsulot, operator va sotuvchilar, nomi bo‘yicha. */
export class LeadFilterOptionsDto {
  @ApiProperty({ type: [LeadFilterOptionDto] })
  products: LeadFilterOptionDto[];
  @ApiProperty({ type: [LeadFilterOptionDto] })
  operators: LeadFilterOptionDto[];
  @ApiProperty({ type: [LeadFilterOptionDto] })
  affiliates: LeadFilterOptionDto[];
}

export class ReleaseLeadDto {
  @ApiProperty({
    example: 'Operatorning kompyuteri o‘chib qoldi',
    maxLength: 500,
  })
  @Transform(trimLeadText)
  @IsString()
  @IsNotEmpty({ message: 'reason bo‘shatish sababi majburiy' })
  @MaxLength(500)
  reason: string;
}

export class LeadReleasedDto {
  @ApiProperty({ example: '1284' }) leadId: string;
  @ApiProperty({ enum: LeadStatus, example: LeadStatus.NEW })
  status: LeadStatus;
}

/** Tekshiruvdagi ariza bo‘yicha qaror (LID-5; dizayn admin-tekshiruvdagi-lidlar). */
export enum LeadReviewDecision {
  /** Navbatga yangi lid bo‘lib tushadi. */
  QUEUE = 'QUEUE',
  /** «Yaroqsiz» deb yopiladi; yozuv o‘chmaydi. */
  SPAM = 'SPAM',
}

export enum LeadReviewResult {
  DONE = 'DONE',
  NOT_FOUND = 'NOT_FOUND',
  /** Tekshiruvda emas (qaror allaqachon qilingan yoki yopilgan). */
  NOT_IN_REVIEW = 'NOT_IN_REVIEW',
  /** Shu raqam va mahsulotda boshqa faol lid bor — ikkinchisi ochilmaydi (LID-4). */
  ACTIVE_LEAD_EXISTS = 'ACTIVE_LEAD_EXISTS',
}

export class LeadReviewDecisionDto {
  @ApiProperty({ type: [String], example: ['1301', '1302'], maxItems: 100 })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @ArrayMaxSize(100)
  @IsLeadBigintId('leadIds', { each: true })
  leadIds: string[];

  @ApiProperty({ enum: LeadReviewDecision, example: LeadReviewDecision.QUEUE })
  @IsEnum(LeadReviewDecision)
  decision: LeadReviewDecision;

  @ApiProperty({ example: 'Boshqa qurilma, haqiqiy mijoz', maxLength: 500 })
  @Transform(trimLeadText)
  @IsString()
  @IsNotEmpty({ message: 'reason qaror sababi majburiy' })
  @MaxLength(500)
  reason: string;
}

export class LeadReviewItemDto {
  @ApiProperty({ example: '1301' }) leadId: string;
  @ApiProperty({ enum: LeadReviewResult, example: LeadReviewResult.DONE })
  result: LeadReviewResult;

  @ApiProperty({
    enum: LeadStatus,
    example: LeadStatus.NEW,
    nullable: true,
    description: 'Hozirgi holati; topilmasa — null',
  })
  status: LeadStatus | null;
}

/** Har ariza alohida hal qilinadi: bittasi o‘tmasa qolganlariga ta’sir qilmaydi. */
export class LeadReviewedDto {
  @ApiProperty({ example: 2, description: 'Qaror qo‘llanganlar soni' })
  done: number;
  @ApiProperty({ type: [LeadReviewItemDto] }) items: LeadReviewItemDto[];
}

/** CSV ustunlari (FE-26 «CSV eksport»). */
export enum LeadExportColumn {
  LEAD = 'lead',
  CUSTOMER = 'customer',
  PHONE = 'phone',
  STREAM = 'stream',
  PRICE = 'price',
  OPERATOR = 'operator',
  ATTEMPTS = 'attempts',
  STATUS = 'status',
  CREATED_AT = 'createdAt',
  SUBS = 'subs',
}

/** Telefon: hozir faqat oxirgi 4 raqam; to‘liq raqam — 403 (ega qarori kutilmoqda, 134-savol). */
export enum ExportPhone {
  LAST4 = 'LAST4',
  FULL = 'FULL',
}

export class LeadExportRequestDto {
  @ApiProperty({
    type: AdminLeadFilterDto,
    description: 'Ro‘yxat filtrlari (sahifalash va saralashsiz)',
  })
  @ValidateNested()
  @Type(() => AdminLeadFilterDto)
  @IsNotEmpty()
  filters: AdminLeadFilterDto;

  @ApiProperty({
    enum: LeadExportColumn,
    isArray: true,
    example: [LeadExportColumn.LEAD, LeadExportColumn.CUSTOMER],
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @ArrayMaxSize(Object.keys(LeadExportColumn).length)
  @IsEnum(LeadExportColumn, { each: true })
  columns: LeadExportColumn[];

  @ApiPropertyOptional({ enum: ExportPhone, default: ExportPhone.LAST4 })
  @IsOptional()
  @IsEnum(ExportPhone)
  phone?: ExportPhone;
}

/** 202: fayl so‘ralganda tayyorlanadi — `file` dan yuklab olinadi (shu admin, vaqtli havola). */
export class ExportAcceptedDto {
  @ApiProperty({ example: 'eyJ2Ijox…' }) id: string;
  @ApiProperty({ example: 128, description: 'Filtrga tushgan qatorlar' })
  rows: number;

  @ApiProperty({
    example: '/api/v1/admin/leads/exports/eyJ2Ijox…',
    description: 'CSV fayl (UTF-8 BOM, «;»), `expiresAt` gacha',
  })
  file: string;

  @ApiProperty({ example: '2027-01-14T10:38:00.000Z' }) expiresAt: string;
}

/** Eksport bo‘lagi (gateway → lead-service): kalit — lid ID si, yangisidan eskisiga. */
export interface LeadExportChunkInput {
  filters: AdminLeadFilterDto;
  columns: LeadExportColumn[];
  /** Eksport so‘ralgan vaqt: undan keyin kelgan lid kirmaydi. */
  until: string;
  afterId: string | null;
}

export interface LeadExportChunk {
  lines: string[];
  nextAfterId: string | null;
}
