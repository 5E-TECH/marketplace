import {
  ApiProperty,
  ApiPropertyOptional,
  OmitType,
  PickType,
} from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsJWT,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { CreateWholesalerDto, WholesalerDto } from './wholesaler.dto';
import { DeclareInboundDto } from './warehouse-inbound.dto';

/**
 * BE-30 (TZ 6.9 OPT-1–4, 6.6 OMB-1, 6.13 NRX-2): optovik kabineti — o‘zi ro‘yxatdan o‘tadi (SMS kod, rekvizitlar,
 * elektron komissiya shartnomasi), mahsulot taklif qiladi, postavka arizasini yuboradi, panelda ombor va pulni,
 * o‘z mahsulotining narx hisobini ko‘radi. Yopiq hujjatlar (KYC, sertifikat, shartnoma) — imzolangan havola bilan.
 */
export const WHOLESALER_CABINET_RPC = {
  /** identity: SMS tasdiqlangan raqamga WHOLESALER foydalanuvchisi (shartnoma va rozilik qabul qilinadi). */
  REGISTER_USER: 'auth.register.wholesaler',
  /** identity: admin bog‘laydigan raqamga WHOLESALER foydalanuvchisi (bor bo‘lsa — o‘sha). */
  ENSURE_USER: 'identity.wholesaler.ensure-user',
  /** identity: kabinetda ro‘yxatni yakunlash — shartnoma va rozilikni qabul qilish (joriy versiyalar). */
  ACCEPT_DOCUMENTS: 'identity.wholesaler.accept-documents',
  TIN_FREE: 'catalog.wholesaler.tin-free',
  SELF_REGISTER: 'catalog.wholesaler.self-register',
  REVIEW: 'catalog.wholesaler.admin-review',
  LINK_OWNER: 'catalog.wholesaler.admin-link-owner',
  ME: 'catalog.wholesaler.me',
  PRODUCT_CREATE: 'catalog.wholesaler.product.create',
  PRODUCT_LIST: 'catalog.wholesaler.product.list',
  PRODUCT_GET: 'catalog.wholesaler.product.get',
  PRICING: 'catalog.wholesaler.pricing',
  VARIANTS: 'catalog.wholesaler.variants',
  DOCUMENT_ADD: 'catalog.wholesaler.document.add',
  DOCUMENT_LIST: 'catalog.wholesaler.document.list',
  DOCUMENT_GET: 'catalog.wholesaler.document.get',
  CONTRACT_PDF: 'catalog.wholesaler.contract-pdf',
  PRIVATE_UPLOAD_POLICY: 'file.private.upload-policy',
  PRIVATE_VERIFY: 'file.private.verify',
  PRIVATE_GET: 'file.private.get',
  STOCK_SUMMARY: 'inventory.wholesaler.summary',
  BALANCE: 'finance.wholesaler.balance',
} as const;

/** Elektron komissiya shartnomasi raqami (OPT-1) — o‘zi ro‘yxatdan o‘tgan optovikda [taklif, egaga savol 3]. */
export const SELF_CONTRACT_PREFIX = 'OPT-E-';

/** Yopiq hujjat hajmi chegarasi, bayt [taklif, egaga savol 5]. */
export const PRIVATE_DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;
/** Imzolangan havola amal muddati, soniya [taklif, egaga savol 5]. */
export const SIGNED_LINK_TTL_SECONDS = 600;
export const PRIVATE_DOCUMENT_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
] as const;
export type PrivateDocumentContentType =
  (typeof PRIVATE_DOCUMENT_TYPES)[number];

export enum WholesalerDocumentKind {
  /** Ro‘yxat hujjatlari (guvohnoma, litsenziya va h.k.). */
  KYC = 'KYC',
  /** Mahsulot sertifikati (OPT-2). */
  CERTIFICATE = 'CERTIFICATE',
}

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** Optovik o‘zi kiritadigan rekvizitlar (OPT-1) — admin kiritishdagi maydonlar, shartnomasiz (u elektron). */
export class WholesalerProfileInputDto extends PickType(CreateWholesalerDto, [
  'name',
  'legalType',
  'tin',
  'bankName',
  'bankAccount',
  'bankMfo',
  'address',
  'description',
] as const) {}

/** `POST /auth/register/wholesaler` — SMS tasdig‘idan keyin. */
export class RegisterWholesalerDto extends WholesalerProfileInputDto {
  @ApiProperty({ description: 'OTP tasdig‘idan keyingi bir martalik token' })
  @IsJWT()
  registrationToken: string;

  @ApiProperty({
    example: '1.0',
    description: 'Qabul qilingan komissiya shartnomasi versiyasi',
  })
  @IsString()
  @MaxLength(20)
  contractVersion: string;

  @ApiProperty({
    example: '1.0',
    description: 'Shaxsiy ma’lumotlarga rozilik versiyasi',
  })
  @IsString()
  @MaxLength(20)
  consentVersion: string;
}

/** `POST /wholesaler/profile` — ro‘yxatni kabinetda yakunlash (rekvizitlar va hujjatlar). */
export class CompleteWholesalerProfileDto extends WholesalerProfileInputDto {
  @ApiProperty({ example: '1.0' })
  @IsString()
  @MaxLength(20)
  contractVersion: string;

  @ApiProperty({ example: '1.0' })
  @IsString()
  @MaxLength(20)
  consentVersion: string;
}

/** identity `auth.register.wholesaler` — gateway faqat token va versiyalarni beradi. */
export type RegisterWholesalerUserInput = Pick<
  RegisterWholesalerDto,
  'registrationToken' | 'contractVersion' | 'consentVersion'
> & { name: string };

/** catalog `catalog.wholesaler.self-register` (identity foydalanuvchini yaratgandan keyin). */
export interface SelfRegisterWholesalerInput extends WholesalerProfileInputDto {
  ownerUserId: string;
  phone: string;
  contractVersion: string;
}

export class ReviewWholesalerDto {
  @ApiProperty({ enum: ['APPROVE', 'REJECT'], example: 'APPROVE' })
  @IsIn(['APPROVE', 'REJECT'])
  decision: 'APPROVE' | 'REJECT';

  @ApiPropertyOptional({
    example: 'STIR soliq bazasida topilmadi',
    description: 'Rad etishda majburiy',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class LinkWholesalerOwnerDto {
  @ApiProperty({
    example: '+998901110015',
    description: 'Optovik kabinetiga SMS kod bilan kiradigan raqam',
  })
  @Transform(trim)
  @Matches(/^\+998\d{9}$/, {
    message: 'Telefon +998XXXXXXXXX formatida bo‘lishi kerak',
  })
  phone: string;

  @ApiProperty({ example: 'Akmal Karimov' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;
}

/** Optovik kabineti profili — admin ko‘radigan yozuvning o‘zi (rekvizitlar va shartnoma bilan). */
export class WholesalerProfileDto extends WholesalerDto {}

export class PrivateUploadPolicyDto {
  @ApiProperty({ enum: WholesalerDocumentKind })
  @IsEnum(WholesalerDocumentKind)
  kind: WholesalerDocumentKind;

  @ApiProperty({ example: 'guvohnoma.pdf' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  fileName: string;

  @ApiProperty({ enum: PRIVATE_DOCUMENT_TYPES })
  @IsIn(PRIVATE_DOCUMENT_TYPES as unknown as string[])
  contentType: PrivateDocumentContentType;

  @ApiProperty({ example: 524288, description: 'Bayt' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(PRIVATE_DOCUMENT_MAX_BYTES)
  size: number;
}

export class PrivateUploadPolicyResultDto {
  @ApiProperty() url: string;
  @ApiProperty({ type: Object }) fields: Record<string, string>;
  @ApiProperty({ example: 'private-uploads/15/1f0c….pdf' }) objectKey: string;
  @ApiProperty() expiresAt: string;
  @ApiProperty() maxSize: number;
}

export class ConfirmWholesalerDocumentDto {
  @ApiProperty({ enum: WholesalerDocumentKind })
  @IsEnum(WholesalerDocumentKind)
  kind: WholesalerDocumentKind;

  @ApiProperty({ example: 'private-uploads/15/1f0c….pdf' })
  @IsString()
  @MaxLength(300)
  objectKey: string;

  @ApiProperty({ example: 'guvohnoma.pdf' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  fileName: string;

  @ApiPropertyOptional({
    example: '42',
    description: 'Sertifikat qaysi mahsulotga (CERTIFICATE da majburiy)',
  })
  @IsOptional()
  @Matches(/^\d+$/, { message: 'productId musbat son bo‘lishi kerak' })
  productId?: string;
}

/** file-service `file.private.verify` natijasi — yopiq joyga ko‘chirilgan fayl. */
export interface PrivateFileVerified {
  objectKey: string;
  contentType: PrivateDocumentContentType;
  size: number;
}

export class WholesalerDocumentDto {
  @ApiProperty({ example: '7' }) id: string;
  @ApiProperty({ example: '15' }) wholesalerId: string;
  @ApiProperty({ enum: WholesalerDocumentKind }) kind: WholesalerDocumentKind;
  @ApiProperty({ example: '42', nullable: true, type: String })
  productId: string | null;
  @ApiProperty({ example: 'guvohnoma.pdf' }) fileName: string;
  @ApiProperty({ enum: PRIVATE_DOCUMENT_TYPES }) contentType: string;
  @ApiProperty({ example: 524288 }) size: number;
  @ApiProperty() createdAt: string;
}

/** Ichki (gateway ↔ catalog): havola uchun saqlash kaliti. */
export interface WholesalerDocumentRecord extends WholesalerDocumentDto {
  objectKey: string;
}

export class SignedLinkDto {
  @ApiProperty({ example: '/api/v1/signed-files/eyJ….c2ln' }) url: string;
  @ApiProperty() expiresAt: string;
}

export class WholesalerShipmentDeclareDto extends OmitType(DeclareInboundDto, [
  'wholesalerId',
] as const) {}

export class WholesalerProductsQueryDto {
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

/** Panel: bitta variant bo‘yicha ombor raqamlari (OPT-3). */
export class WholesalerStockRowDto {
  @ApiProperty({ example: '42' }) productId: string;
  @ApiProperty({ example: 'Simsiz quloqchin' }) productName: string;
  @ApiProperty({ example: '901' }) variantId: string;
  @ApiProperty({ example: 'Q-1' }) sku: string;
  @ApiProperty({ example: 120, description: 'Omborda (jismonan)' })
  onHand: number;
  @ApiProperty({ example: 8, description: 'Bandda' }) reserved: number;
  @ApiProperty({
    example: 110,
    description: 'Sotuvda bor (omborda − band − muddati sabab to‘silgan)',
  })
  available: number;
  @ApiProperty({
    example: 50,
    description: 'Yo‘lda — e’lon qilingan, hali qabul qilinmagan postavka',
  })
  inTransit: number;
  @ApiProperty({ example: 34, description: 'Sotilgan (Elchi’ga topshirilgan)' })
  sold: number;
  @ApiProperty({ example: 3, description: 'Qaytgan (saralangan)' })
  returned: number;
  @ApiProperty({
    example: 2,
    description: 'Brak (qabulda va qaytgan saralashda)',
  })
  defective: number;
}

export type WholesalerStockTotals = Omit<
  WholesalerStockRowDto,
  'productId' | 'productName' | 'variantId' | 'sku'
>;

export class WholesalerMoneyDto {
  @ApiProperty({
    example: 1_250_000,
    description: 'Ushlab turilgan — Elchi puli hali kelmagan sotuvlar',
  })
  held: number;
  @ApiProperty({ example: 980_000, description: 'To‘lanadigan' })
  payable: number;
  @ApiProperty({ example: 4_300_000, description: 'To‘langan' })
  paid: number;
}

export class WholesalerDashboardDto {
  @ApiProperty({ type: [WholesalerStockRowDto] })
  stock: WholesalerStockRowDto[];
  @ApiProperty({ type: Object }) stockTotals: WholesalerStockTotals;
  @ApiProperty({ type: WholesalerMoneyDto }) money: WholesalerMoneyDto;
}

/** Ichki: gateway → identity admin bog‘lashi. */
export type EnsureWholesalerUserInput = LinkWholesalerOwnerDto;

/** Ichki: gateway → catalog rad/tasdiq. */
export type ReviewWholesalerInput = ReviewWholesalerDto & {
  wholesalerId: string;
};

export class WholesalerPricingQueryDto {
  @ApiPropertyOptional({
    example: 251000,
    description: 'Shu narxda taqsimot (sukut: tasdiqlangan yoki tavsiya)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  price?: number;
}
