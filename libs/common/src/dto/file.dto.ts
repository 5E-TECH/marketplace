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
  isCover = false;
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

export type UploadFileCommand = {
  originalName: string;
  mimeType: string;
  size: number;
  base64: string;
};
