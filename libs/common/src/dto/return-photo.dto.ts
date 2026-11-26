import { ApiProperty } from '@nestjs/swagger';

/** BE-25 (FE-26): qaytarish so‘roviga mijoz rasmlari — yopiq saqlanadi, imzolangan havola bilan ochiladi. */
export const RETURN_PHOTO_RPC = {
  /** checkout: ochiq so‘rov va joy bormi (fayllar saqlanishidan oldin). */
  CHECK: 'checkout.admin.return-photo-check',
  ADD: 'checkout.admin.return-photo-add',
  GET: 'checkout.admin.return-photo-get',
  /** file: yopiq saqlash va o‘chirish. */
  STORE: 'file.return-photo.store',
  REMOVE: 'file.return-photo.remove',
} as const;

/** FE-26: 3 tagacha, har biri 5 MB gacha. */
export const RETURN_PHOTO_MAX = 3;
export const RETURN_PHOTO_MAX_BYTES = 5 * 1024 * 1024;

export interface StoredReturnPhoto {
  objectKey: string;
  contentType: string;
  size: number;
}

export class ReturnPhotoDto {
  @ApiProperty({ example: '9' }) id: string;
  @ApiProperty({ example: 'image/jpeg' }) contentType: string;
  @ApiProperty({ example: 245678 }) size: number;
  @ApiProperty({ example: '2026-12-01T09:14:00.000Z' }) createdAt: string;
}

export class ReturnPhotosResultDto {
  @ApiProperty({ example: '3', description: 'Qaytarish so‘rovi ID si' })
  returnId: string;
  @ApiProperty({ example: 2, description: 'So‘rovdagi jami rasm' })
  count: number;
  @ApiProperty({ type: [ReturnPhotoDto] }) photos: ReturnPhotoDto[];
}
