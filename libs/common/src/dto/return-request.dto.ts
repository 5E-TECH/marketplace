import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
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
  ValidateNested,
} from 'class-validator';
import { MAX_MONEY } from '../database/money.transformer';
import { ReturnReason, ReturnRequestStatus } from '../enums';
import { ReturnPhotoDto } from './return-photo.dto';

// ─── So'rovlar ──────────────────────────────────────────────────────────────

export class ReturnRequestItemInputDto {
  @ApiPropertyOptional({
    example: '31',
    description:
      'Buyurtma qatori ID si (`sellerOrders[].items[].id`). Berilmasa — `productId`',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[1-9]\d{0,18}$/)
  orderItemId?: string;

  @ApiPropertyOptional({
    example: '501',
    description:
      'Mahsulot ID si — buyurtmada shu mahsulot bitta qatorda bo‘lsa yetarli (FE-26)',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[1-9]\d{0,18}$/)
  productId?: string;

  @ApiProperty({ example: 1, minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  quantity: number;
}

/** C4.2 — `POST /orders/:orderId/returns`. */
export class CreateReturnRequestDto {
  @ApiProperty({
    type: [ReturnRequestItemInputDto],
    description:
      'Qaytariladigan tovarlar. Turli do‘konlarning tovarlari bo‘lsa, ' +
      'har posilka uchun alohida so‘rov yaratiladi.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ReturnRequestItemInputDto)
  items: ReturnRequestItemInputDto[];

  @ApiProperty({ enum: ReturnReason, example: ReturnReason.DEFECTIVE })
  @IsEnum(ReturnReason)
  reason: ReturnReason;

  @ApiPropertyOptional({
    example: 'Ekranda chiziq bor',
    description: '`OTHER` sababida majburiy',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}

export class ReturnRequestsQueryDto {
  @ApiPropertyOptional({ enum: ReturnRequestStatus })
  @IsOptional()
  @IsEnum(ReturnRequestStatus)
  status?: ReturnRequestStatus;

  @ApiPropertyOptional({ type: Number, example: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ type: Number, example: 20, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;
}

export class AdminReturnRequestsQueryDto extends ReturnRequestsQueryDto {
  @ApiPropertyOptional({ example: '7' })
  @IsOptional()
  @Matches(/^[1-9]\d{0,18}$/)
  shopId?: string;

  @ApiPropertyOptional({ example: '42', description: 'sales_order ID' })
  @IsOptional()
  @Matches(/^[1-9]\d{0,18}$/)
  orderId?: string;

  @ApiPropertyOptional({ example: '2026-09-01' })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional({ example: '2026-09-30' })
  @IsOptional()
  @IsDateString()
  dateTo?: string;
}

export class ReturnReviewDto {
  @ApiPropertyOptional({ example: 'Tovar qabul qilindi, tekshirilmoqda' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}

export class ReturnApproveDto extends ReturnReviewDto {}

export class ReturnRejectDto {
  @ApiProperty({ example: 'Tovar ishlatilgan, qadog‘i yo‘q' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason: string;
}

/** `POST /admin/returns/:id/refund` — qisman summa ruxsat etiladi. */
export class AdminReturnRefundDto {
  @ApiPropertyOptional({
    example: 99000,
    description:
      'Qaytariladigan summa. Berilmasa so‘rovdagi tovarlar summasi to‘liq ' +
      'qaytariladi; kichikroq summa (masalan, xaridor aybi bilan shikast) — qisman refund.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt() // BE-01: pul — butun so‘m
  @Max(MAX_MONEY)
  @Min(1)
  amount?: number;

  @ApiPropertyOptional({
    example: true,
    description:
      'Tovar omborga qayta qo‘shilsinmi. Default: sifat muammosi ' +
      '(DEFECTIVE/DAMAGED/INCOMPLETE/WRONG_ITEM) bo‘lsa `false`, aks holda `true`.',
  })
  @IsOptional()
  @IsBoolean()
  restock?: boolean;

  @ApiPropertyOptional({ example: 'Karta orqali qaytarildi, chek #123' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}

// ─── Javoblar ───────────────────────────────────────────────────────────────

export class ReturnRequestItemDto {
  @ApiProperty({ example: '5' }) id: string;
  @ApiProperty({ example: '31' }) orderItemId: string;
  @ApiProperty({ example: '7' }) productId: string;
  @ApiProperty({ example: '12' }) variantId: string;
  @ApiProperty({ example: 'Smartfon Nova 12' }) productName: string;
  @ApiProperty({ example: null, nullable: true, type: String })
  imageUrl: string | null;
  @ApiProperty({ example: 1 }) quantity: number;
  @ApiProperty({ example: 99000 }) unitPrice: number;
  @ApiProperty({ example: 99000 }) lineTotal: number;
}

export class ReturnRequestHistoryDto {
  @ApiProperty({ enum: ReturnRequestStatus, nullable: true })
  fromStatus: ReturnRequestStatus | null;
  @ApiProperty({ enum: ReturnRequestStatus }) toStatus: ReturnRequestStatus;
  @ApiProperty({ example: 'SELLER' }) actorRole: string;
  @ApiProperty({ example: null, nullable: true, type: String })
  comment: string | null;
  @ApiProperty() createdAt: Date;
}

export class ReturnRequestDto {
  @ApiProperty({ example: '3' }) id: string;
  @ApiProperty({ example: '42', description: 'sales_order ID' })
  orderId: string;
  @ApiProperty({
    example: '51',
    description: 'Posilka (sales_order_seller) ID',
  })
  sellerOrderId: string;
  @ApiProperty({ example: '7' }) shopId: string;
  @ApiProperty({ example: 'Nova Store', nullable: true, type: String })
  shopName: string | null;
  @ApiProperty({ example: 'Ali Valiyev', nullable: true, type: String })
  buyerName: string | null;
  @ApiProperty({ enum: ReturnRequestStatus }) status: ReturnRequestStatus;
  @ApiProperty({ enum: ReturnReason }) reason: ReturnReason;
  @ApiProperty({ nullable: true, type: String }) comment: string | null;
  @ApiProperty({ example: 'online', enum: ['online', 'cod'] })
  paymentMethod: string;
  @ApiProperty({ example: 99000, description: 'Tanlangan tovarlar summasi' })
  requestedAmount: number;
  @ApiProperty({ example: null, nullable: true, type: Number })
  refundedAmount: number | null;
  @ApiProperty({ example: null, nullable: true, type: Boolean })
  restocked: boolean | null;
  @ApiProperty({
    nullable: true,
    type: String,
    description: 'Oxirgi qaror izohi (rad etish sababi yoki tasdiq izohi)',
  })
  decisionComment: string | null;
  @ApiProperty({ nullable: true, type: Date }) decidedAt: Date | null;
  @ApiProperty({ nullable: true, type: Date }) refundedAt: Date | null;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
  @ApiProperty({ type: [ReturnRequestItemDto] }) items: ReturnRequestItemDto[];
}

export class ReturnRequestDetailsDto extends ReturnRequestDto {
  @ApiProperty({ type: [ReturnRequestHistoryDto] })
  history: ReturnRequestHistoryDto[];

  @ApiProperty({
    type: [ReturnPhotoDto],
    description:
      'Mijoz rasmlari; ochish — `POST admin/returns/{id}/photos/{photoId}/link`',
  })
  photos: ReturnPhotoDto[];
}

export class ReturnRequestsPageDto {
  @ApiProperty({ type: [ReturnRequestDto] }) items: ReturnRequestDto[];
  @ApiProperty({ example: 1 }) total: number;
  @ApiProperty({ example: 1 }) page: number;
  @ApiProperty({ example: 20 }) limit: number;
  @ApiProperty({ example: 1 }) totalPages: number;
}

export class CreateReturnRequestsResultDto {
  @ApiProperty({
    type: [ReturnRequestDto],
    description: 'Har posilka (do‘kon) uchun bitta so‘rov',
  })
  items: ReturnRequestDto[];
}

// ─── Katalogdan ko‘rinish ma’lumoti (BE-29) ─────────────────────────────────

/**
 * BE-29: checkout qaytarishlar ro‘yxati va savat uchun do‘kon nomi, mahsulot va variant rasmini katalogdan RPC bilan
 * oladi — boshqa servis sxemasiga (`catalog.*`) SQL bilan murojaat qilinmaydi. O‘chirilgan (soft-delete) do‘kon,
 * mahsulot va variant ham qaytadi (tarix; xaridor savatdan nimani olib tashlayotganini ko‘rsin).
 */
export const CATALOG_DISPLAY_LOOKUP = 'catalog.display.lookup';

export interface CatalogDisplayLookupRequest {
  shopIds?: string[];
  productIds?: string[];
  variantIds?: string[];
}

export interface CatalogDisplayLookupResult {
  shops: Array<{ id: string; name: string | null }>;
  /** `expiryTracked` — postavkada muddat kuzatiladi (BAD yoki toifa belgisi, OMB-3; BE-25). */
  products: Array<{
    id: string;
    /** Mahsulot nomi (o‘chirilgani ham — tarix); BE-33 akt-sverka PDF. */
    name: string | null;
    imageUrl: string | null;
    expiryTracked: boolean;
  }>;
  /** Variant rasmi, u bo‘lmasa mahsulot rasmi yoki birinchi rasmi; nomi — mahsulot nomi. */
  variants: Array<{ id: string; name: string | null; imageUrl: string | null }>;
}
