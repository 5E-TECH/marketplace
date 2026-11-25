import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, Matches } from 'class-validator';

export class UploadProductImageDto {
  @ApiProperty({ example: '12', description: 'Mahsulot ID si' })
  @Matches(/^\d+$/, { message: "productId musbat son bo'lishi kerak" })
  productId: string;

  @ApiPropertyOptional({
    example: false,
    default: false,
    description: 'Rasmni mahsulot cover rasmi qilish',
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  isCover: boolean = false;
}

/** Mahsulot rasmi chegarasi (FE-25 §9; BE-08 kreativ rasmi bilan bir xil). */
export const PRODUCT_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const PRODUCT_IMAGE_TYPES: readonly string[] = [
  'image/jpeg',
  'image/png',
  'image/webp',
];

/** `POST admin/products/media`, `POST wholesaler/products/media` (FE-25 §9, FE-23). */
export class ProductMediaDto {
  @ApiProperty({
    example:
      'http://localhost:9000/marketplace-media/products/1722250000000-uuid.jpg',
    description:
      'Mahsulotning `images` / `imageUrl` maydoniga shu URL yuboriladi',
  })
  url: string;

  @ApiProperty({ enum: ['IMAGE'], example: 'IMAGE' })
  type: 'IMAGE';

  @ApiProperty({ example: 'quloqchin-1.jpg' })
  fileName: string;

  @ApiProperty({ example: 'image/jpeg' })
  contentType: string;

  @ApiProperty({ example: 245678 })
  size: number;
}

export class UploadedFileDto {
  @ApiProperty({ example: 'products/1722250000000-uuid.jpg' })
  objectName: string;

  @ApiProperty({ example: 'marketplace-media' })
  bucket: string;

  @ApiProperty({
    example:
      'http://localhost:9000/marketplace-media/products/1722250000000-uuid.jpg',
  })
  url: string;

  @ApiProperty({ example: 'image/jpeg' })
  mimeType: string;

  @ApiProperty({ example: 245678 })
  size: number;
}

export class ProductImageUploadResultDto extends UploadedFileDto {
  @ApiProperty({ example: '12' })
  productId: string;

  @ApiProperty({ example: false })
  isCover: boolean;
}

/**
 * MinIO ichidagi ochiq papkalar. Bucket siyosati faqat shularni o'qishga
 * ochadi, shuning uchun yangi papka qo'shilsa file-service siyosati ham
 * yangilanadi (FileServiceService.configurePublicReadPolicy).
 */
export const PUBLIC_MEDIA_FOLDERS = ['products', 'banners'] as const;
export type MediaFolder = (typeof PUBLIC_MEDIA_FOLDERS)[number];

export type UploadFileCommand = {
  originalName: string;
  mimeType: string;
  size: number;
  base64: string;
  /** Berilmasa `products` — mavjud mahsulot rasmlari oqimi o'zgarmaydi. */
  folder?: MediaFolder;
};
