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

/**
 * Yuklash papkasi: ochiq emas, fayllar 1 kundan keyin o‘chadi (MinIO lifecycle) [taklif]. Brauzer faylni shu yerga
 * yuklaydi; tekshiruvdan o‘tgani server tomonida `creatives/` ga ko‘chiriladi. Shuning uchun imzo qayta ishlatilsa
 * ham tekshirilgan fayl almashtirilmaydi, tasdiqlanmagan fayl ochiq havolada turmaydi.
 */
export const CREATIVE_UPLOAD_FOLDER = 'creative-uploads';

/** Yuklash kaliti: `creative-uploads/<mahsulot>/<uuid>.<kengaytma>`. */
export const CREATIVE_UPLOAD_KEY =
  /^creative-uploads\/(\d{1,19})\/([0-9a-f-]{36}\.(?:mp4|webm|jpg|png|webp))$/;

/** Yuklash kalitidan yakuniy (ochiq) kalit: `creatives/<mahsulot>/<uuid>.<kengaytma>`; noto‘g‘ri kalit — null. */
export function creativeKeyFromUpload(uploadKey: string): string | null {
  const match = CREATIVE_UPLOAD_KEY.exec(String(uploadKey ?? ''));
  return match ? `${CREATIVE_FOLDER}/${match[1]}/${match[2]}` : null;
}

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
  /** gateway → catalog: shu fayl allaqachon kreativmi (takroriy tasdiq). */
  FIND: 'catalog.creative.find',
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
    type: 'object',
    additionalProperties: { type: 'string' },
    description:
      'Formaga shu maydonlar (o‘zgartirmasdan) va oxirida `file` qo‘shiladi',
    example: { key: 'creatives/12/…mp4', 'Content-Type': 'video/mp4' },
  })
  fields: Record<string, string>;

  @ApiProperty({
    example: 'creative-uploads/12/7b0c…mp4',
    description: 'Tasdiqlashda shu kalit yuboriladi',
  })
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
  @ApiProperty({
    example: 'creative-uploads/12/7b0c3e1a-….mp4',
    description: 'Yuklash javobidagi `objectKey`',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  @Matches(CREATIVE_UPLOAD_KEY, { message: 'objectKey noto‘g‘ri' })
  objectKey: string;
}

/** file-service tekshiruvi natijasi: fayl `creatives/` ga ko‘chirilgan, `objectKey` — yakuniy kalit. */
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
