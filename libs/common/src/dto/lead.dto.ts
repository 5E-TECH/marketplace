import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { CheckoutDeliveryDestination } from './cart.dto';

// Lid-sotuv: sotuvchi sahifasi (oqim), klik va lid qabul qilish (BE-25 shartnomasi).
// Real kod: BE-10 (lead-service), BE-11 (sahifa va klik), BE-12 (POST /leads), BE-38 (manzil).
// Manzil kaliti — SOATO (ega javobi 2026-11-16, EQ-06): `regionSoato`/`districtSoato`
// `/regions` javobidagi `satoCode` qiymatlari, Elchi ID emas.
// Yetkazish turi — mavjud CheckoutDeliveryDestination (CENTER = markazgacha, ADDRESS = eshikkacha).

/** S1/S3 sinovi varianti (LID-8). Operator, sotuvchi va admin javoblarida ko‘rsatilmaydi. */
export enum LeadVariant {
  S1 = 's1',
  S3 = 's3',
}

/** Lid holatlari (TZ 5-bo‘lim, 8 holat; content-spec.md). */
export enum LeadStatus {
  NEW = 'NEW',
  BOOKED = 'BOOKED',
  CALLBACK = 'CALLBACK',
  CONFIRMED = 'CONFIRMED',
  REJECTED = 'REJECTED',
  INVALID = 'INVALID',
  MERGED = 'MERGED',
  NO_CONTACT = 'NO_CONTACT',
}

/** Lid manbasi (BUY-1: lid, sayt, API). LANDING — sotuvchi sahifasi. */
export enum LeadSource {
  LANDING = 'LANDING',
  SITE = 'SITE',
  API = 'API',
}

/** Sotuvchi sahifasi shabloni (SOT-3). */
export enum StreamTemplate {
  STANDART = 'STANDART',
  VIDEO = 'VIDEO',
}

/**
 * Sotuvchi sahifasining mijozga ko‘rinadigan holati (BE-11): ochiq, vaqtincha yo‘q (qoldiq 0),
 * bu havola orqali qabul qilinmaydi (admin to‘xtatgan yoki sotuvchi bloklangan), sotuvdan olingan.
 */
export enum LandingPageState {
  OPEN = 'OPEN',
  OUT_OF_STOCK = 'OUT_OF_STOCK',
  NOT_ACCEPTED = 'NOT_ACCEPTED',
  WITHDRAWN = 'WITHDRAWN',
}

const PHONE_UZ = /^\+998\d{9}$/;

export class LandingPageProductDto {
  @ApiProperty({ example: '501' }) id: string;
  @ApiProperty({ example: 'Simsiz quloqchinlar' }) name: string;

  @ApiProperty({
    example: 'Bluetooth, quvvatlovchi g‘ilof bilan',
    nullable: true,
    type: String,
  })
  subtitle: string | null;

  @ApiProperty({
    type: [String],
    example: ['https://cdn.example.uz/p/501/1.jpg'],
  })
  images: string[];

  @ApiProperty({ example: null, nullable: true, type: String })
  videoUrl: string | null;

  @ApiProperty({
    example: false,
    description: '«Dori vositasi emas» belgisi (BE-07)',
  })
  isBad: boolean;
}

export class LandingPagePriceDto {
  @ApiProperty({ example: 262000, description: 'Tovar narxi, so‘m' })
  salePrice: number;

  @ApiProperty({
    example: 30000,
    description: 'Markazgacha yetkazish, so‘m; 0 — bepul (BE-09)',
  })
  centerDeliveryFee: number;

  @ApiProperty({
    example: 50000,
    description: 'Eshikkacha yetkazish, so‘m (BE-09)',
  })
  addressDeliveryFee: number;
}

/** GET /landing/:code — sotuvchi sahifasi uchun ochiq javob (BE-11). Bazaviy narx, haq va optovik ma’lumoti yo‘q. */
export class LandingPageDto {
  @ApiProperty({ example: 'k7Qm2x' }) code: string;
  @ApiProperty({ enum: LandingPageState, example: LandingPageState.OPEN })
  state: LandingPageState;

  @ApiProperty({ enum: StreamTemplate, example: StreamTemplate.STANDART })
  template: StreamTemplate;

  @ApiProperty({ type: LandingPageProductDto }) product: LandingPageProductDto;
  @ApiProperty({ type: LandingPagePriceDto }) price: LandingPagePriceDto;

  @ApiProperty({ example: '1234567890', nullable: true, type: String })
  metaPixelId: string | null;

  @ApiProperty({ example: null, nullable: true, type: String })
  tiktokPixelId: string | null;
}

/** Reklama parametrlari: klik va lid uchun bir xil (LID-3, T02:39). */
export class LeadTrackingDto {
  @ApiPropertyOptional({ enum: LeadVariant, example: LeadVariant.S1 })
  @IsOptional()
  @IsEnum(LeadVariant)
  variant?: LeadVariant;

  @ApiPropertyOptional({ example: 'kampaniya-1' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  sub1?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  sub2?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  sub3?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  sub4?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  sub5?: string;

  @ApiPropertyOptional({ example: 'facebook' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  utmSource?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  utmMedium?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  utmCampaign?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  utmContent?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  utmTerm?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(512)
  fbclid?: string;
}

/** POST /clicks — sotuvchi sahifasi serveri yuboradi; IP va user agent so‘rov sarlavhasidan (BE-11). */
export class CreateLandingClickDto extends LeadTrackingDto {
  @ApiProperty({ example: 'k7Qm2x', description: 'Sotuvchi sahifasi kodi' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  code: string;

  @ApiPropertyOptional({ description: 'Meta `_fbp` cookie' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  fbp?: string;

  @ApiPropertyOptional({ description: 'Meta `_fbc` cookie' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  fbc?: string;
}

export class LandingClickCreatedDto {
  @ApiProperty({ example: '90311' }) clickId: string;
}

/**
 * POST /leads — sotuvchi sahifasi formasi (LID-2, LID-3, BE-12, BE-38).
 * Ism, telefon va manzil majburiy; «Markazgacha» tanlansa ham ko‘cha/uy majburiy (ega javobi 2026-11-16).
 */
export class CreateLeadDto extends LeadTrackingDto {
  @ApiProperty({ example: 'k7Qm2x', description: 'Sotuvchi sahifasi kodi' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  code: string;

  @ApiProperty({ example: 'Aziza' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @ApiProperty({
    example: '+998901234567',
    description: 'Operator kodi tekshiruvi BE-12 da',
  })
  @Matches(PHONE_UZ, {
    message: "phone +998XXXXXXXXX formatida bo'lishi kerak",
  })
  phone: string;

  @ApiProperty({ example: '1726', description: 'Viloyat SOATO kodi' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  regionSoato: string;

  @ApiProperty({
    example: '1726266',
    description: 'Tuman yoki shahar SOATO kodi',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  districtSoato: string;

  @ApiProperty({
    example: 'Turkiston ko‘chasi, 27-uy',
    description: 'Ko‘cha, uy',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  addressLine: string;

  @ApiProperty({
    enum: CheckoutDeliveryDestination,
    example: CheckoutDeliveryDestination.CENTER,
    description: 'CENTER — markazgacha, ADDRESS — eshikkacha (P-1)',
  })
  @IsEnum(CheckoutDeliveryDestination)
  whereDeliver: CheckoutDeliveryDestination;

  @ApiProperty({
    example: '2026-11-16',
    description:
      'Mijoz rozi bo‘lgan oferta va maxfiylik matni versiyasi (SF-07)',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  consentVersion: string;

  @ApiPropertyOptional({ example: '90311', description: 'POST /clicks javobi' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  clickId?: string;

  @ApiPropertyOptional({
    description:
      'Yashirin maydon (bot himoyasi): bo‘sh bo‘lishi kerak; to‘ldirilsa lid yozilmaydi, javob baribir 201',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  website?: string;
}

export class LeadCreatedDto {
  @ApiProperty({ example: '7001', description: 'Piksel eventID sifatida ham' })
  leadId: string;

  @ApiProperty({
    example: false,
    description:
      'Shu raqam va mahsulotga avval ariza bo‘lgan: lid birinchi arizaga bog‘landi (9-qoida)',
  })
  duplicate: boolean;
}

/** GET /regions/tree — JS o‘chiq formadagi bitta guruhlangan ro‘yxat (BE-38, ega javobi 2026-11-16). */
export class LeadDistrictOptionDto {
  @ApiProperty({ example: '1726266' }) satoCode: string;
  @ApiProperty({ example: 'Yunusobod tumani' }) name: string;
}

export class LeadRegionGroupDto {
  @ApiProperty({ example: '1726' }) satoCode: string;
  @ApiProperty({ example: 'Toshkent shahri' }) name: string;
  @ApiProperty({ type: [LeadDistrictOptionDto] })
  districts: LeadDistrictOptionDto[];
}
