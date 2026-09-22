import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

/** C6.9 — bosh sahifa reklama bannerlari. */
export class CreateBannerDto {
  @ApiProperty({ example: '50% chegirma' })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  title: string;

  @ApiProperty({
    example: 'https://cdn.example.com/banners/autumn.jpg',
    description: '`POST /files/upload` qaytargan manzil.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  imageUrl: string;

  @ApiPropertyOptional({
    example: '/storefront/products?categoryId=7',
    nullable: true,
    description: 'Bannerga bosilganda ochiladigan sahifa.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  linkUrl?: string | null;

  @ApiPropertyOptional({ example: 10, default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional({ example: true, default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    example: '2026-09-25T00:00:00.000Z',
    nullable: true,
    description: 'Shu vaqtgacha storefront’da ko‘rinmaydi; null — darhol.',
  })
  @IsOptional()
  @IsDateString()
  startsAt?: string | null;

  @ApiPropertyOptional({
    example: '2026-10-01T00:00:00.000Z',
    nullable: true,
    description: 'Shu vaqtdan keyin o‘zi yo‘qoladi; null — muddatsiz.',
  })
  @IsOptional()
  @IsDateString()
  endsAt?: string | null;
}

export class UpdateBannerDto extends PartialType(CreateBannerDto) {}

export class ReorderBannerItemDto {
  @ApiProperty({ example: '3' })
  @Matches(/^[1-9]\d{0,18}$/, { message: "id musbat son bo'lishi kerak" })
  id: string;

  @ApiProperty({ example: 0 })
  @IsInt()
  @Min(0)
  sortOrder: number;
}

export class ReorderBannersDto {
  @ApiProperty({ type: [ReorderBannerItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ReorderBannerItemDto)
  items: ReorderBannerItemDto[];
}

/** Storefront uchun — faqat ko‘rsatishga kerak bo‘lgan maydonlar. */
export class StorefrontBannerDto {
  @ApiProperty({ example: '3' }) id: string;
  @ApiProperty({ example: '50% chegirma' }) title: string;
  @ApiProperty({ example: 'https://cdn.example.com/banners/autumn.jpg' })
  imageUrl: string;
  @ApiProperty({ type: String, example: null, nullable: true })
  linkUrl: string | null;
  @ApiProperty({ example: 10 }) sortOrder: number;
}

/** Admin ro‘yxati — jadval holati va muddati bilan. */
export class BannerDto extends StorefrontBannerDto {
  @ApiProperty({ example: true }) isActive: boolean;

  @ApiProperty({ type: String, example: null, nullable: true })
  startsAt: Date | string | null;

  @ApiProperty({ type: String, example: null, nullable: true })
  endsAt: Date | string | null;

  @ApiProperty({
    example: true,
    description:
      'Shu daqiqada storefront’da ko‘rinayotgani — `isActive` va muddat birga.',
  })
  isVisible: boolean;

  @ApiProperty({ type: String, example: '2026-09-22T10:00:00.000Z' })
  createdAt: Date | string;

  @ApiProperty({ type: String, example: '2026-09-22T10:00:00.000Z' })
  updatedAt: Date | string;
}

export class DeleteBannerResultDto {
  @ApiProperty({ example: '3' }) id: string;
  @ApiProperty({ example: true }) deleted: boolean;
}
