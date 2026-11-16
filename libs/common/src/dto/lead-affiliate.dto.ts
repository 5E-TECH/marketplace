import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { StreamTemplate } from './lead.dto';

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
  @IsString()
  categoryId?: string;

  @ApiPropertyOptional({
    enum: AffiliateOfferSort,
    default: AffiliateOfferSort.NEWEST,
  })
  @IsOptional()
  @IsEnum(AffiliateOfferSort)
  sort?: AffiliateOfferSort;
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

  @ApiProperty({ example: 1850, description: 'EPC, so‘m' }) epc: number;

  @ApiProperty({ example: 41, description: 'Tasdiq foizi' })
  approveRate: number;

  @ApiProperty({ example: 78, description: 'Sotilish foizi' })
  saleRate: number;

  @ApiProperty({ example: 120 }) stock: number;
  @ApiProperty({ example: true }) hasVideo: boolean;
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
  @IsString()
  @MaxLength(32)
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

  @ApiPropertyOptional({ example: '1234567890' })
  @IsString()
  @MaxLength(64)
  metaPixelId: string;

  @ApiPropertyOptional() @IsString() @MaxLength(64) tiktokPixelId: string;

  @ApiPropertyOptional({
    description: 'Postback URL (yuborish ishga tushgandan keyin, BE-14)',
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
  @ApiProperty({ example: 12 }) sales: number;
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
  @IsString()
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
