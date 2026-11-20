import { ApiProperty } from '@nestjs/swagger';
import {
  IsEnum,
  IsInt,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * Kreativlar kutubxonasi (BE-08; TZ T4 `catalog.creative`, 6.1 SOT-2, SOT-9). Kreativni faqat admin yuklaydi,
 * moderatsiya yo‘q (FE-12, BE-27). Yuklash — imzolangan POST policy bilan to‘g‘ridan-to‘g‘ri MinIO ga.
 */
export enum CreativeType {
  IMAGE = 'IMAGE',
  VIDEO = 'VIDEO',
}

/** MinIO dagi papka (ochiq o‘qish siyosatida; `PUBLIC_MEDIA_FOLDERS` dan alohida — banner manzili tekshiruviga kirmaydi). */
export const CREATIVE_FOLDER = 'creatives';

/** Bir mahsulotga kreativlar chegarasi [taklif]. */
export const MAX_CREATIVES_PER_PRODUCT = 20;

/** Ichki RPC nomlari. */
export const CREATIVE_RPC = {
  /** gateway → file-service: yuklash uchun imzolangan POST policy. */
  UPLOAD_POLICY: 'file.creative.upload-policy',
  /** gateway → file-service: yuklangan faylni tekshirish (hajm, tur, birinchi baytlar). */
  VERIFY: 'file.creative.verify',
  /** gateway → file-service: faylni o‘chirish. */
  REMOVE: 'file.creative.remove',
  /** gateway → catalog. */
  CREATE: 'catalog.creative.create',
  LIST: 'catalog.creative.list',
  DELETE: 'catalog.creative.delete',
} as const;

export class CreativeUploadRequestDto {
  @ApiProperty({ enum: CreativeType, example: CreativeType.VIDEO })
  @IsEnum(CreativeType)
  type: CreativeType;

  @ApiProperty({ example: 'video/mp4', description: 'Fayl turi (MIME)' })
  @IsString()
  @MaxLength(100)
  contentType: string;

  @ApiProperty({ example: 83886080, description: 'Fayl hajmi, bayt' })
  @IsInt()
  @Min(1)
  @Max(2 * 1024 * 1024 * 1024)
  size: number;
}

export class CreativeUploadPolicyDto {
  @ApiProperty({
    example: 'https://api.elchimarket.uz/media/marketplace-media',
    description: 'Fayl `multipart/form-data` bilan shu manzilga POST qilinadi',
  })
  url: string;

  @ApiProperty({
    description:
      'Formaga shu maydonlar (o‘zgartirmasdan) va oxirida `file` qo‘shiladi',
    example: { key: 'creatives/12/…mp4', 'Content-Type': 'video/mp4' },
  })
  fields: Record<string, string>;

  @ApiProperty({ example: 'creatives/12/7b0c…mp4' })
  objectKey: string;

  @ApiProperty({ example: '2026-11-21T10:15:00.000Z' })
  expiresAt: string;

  @ApiProperty({
    example: 104857600,
    description: 'Ruxsat etilgan eng katta hajm, bayt',
  })
  maxSize: number;
}

export class CreativeConfirmDto {
  @ApiProperty({ example: 'creatives/12/7b0c3e1a-….mp4' })
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  @Matches(/^creatives\/\d+\/[0-9a-f-]{36}\.[a-z0-9]{2,5}$/, {
    message: 'objectKey noto‘g‘ri',
  })
  objectKey: string;
}

/** file-service tekshiruvi natijasi. */
export interface VerifiedCreativeFile {
  objectKey: string;
  url: string;
  type: CreativeType;
  mimeType: string;
  size: number;
}

export class CreativeDto {
  @ApiProperty({ example: '31' })
  id: string;

  @ApiProperty({ example: '12' })
  productId: string;

  @ApiProperty({ enum: CreativeType })
  type: CreativeType;

  @ApiProperty({
    example:
      'https://api.elchimarket.uz/media/marketplace-media/creatives/12/….mp4',
  })
  url: string;

  @ApiProperty({ example: 'video/mp4' })
  mimeType: string;

  @ApiProperty({ example: 83886080 })
  size: number;

  @ApiProperty({ example: 0 })
  position: number;

  @ApiProperty()
  createdAt: Date;
}
