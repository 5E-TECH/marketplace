import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateCategoryDto {
  @ApiProperty({ example: 'Mobil telefonlar' })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name: string;

  @ApiPropertyOptional({ type: String, example: '1', nullable: true })
  @IsOptional()
  @Matches(/^\d+$/, { message: "parentId musbat son bo'lishi kerak" })
  parentId?: string | null;

  @ApiPropertyOptional({
    type: String,
    example: 'https://cdn.example.com/categories/phones.svg',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  iconUrl?: string | null;

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
    example: 'mobil-telefonlar',
    description: 'Berilmasa — nomdan hosil qilinadi; takrori 409',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
    message: 'slug: kichik lotin harflari, raqam va «-»',
  })
  slug?: string;

  @ApiPropertyOptional({
    example: null,
    nullable: true,
    type: Boolean,
    description:
      'BAD toifasi (TZ 8): mahsulotlarida «Dori vositasi emas». null — ota toifadan, eng yuqorida «yo‘q»',
  })
  @IsOptional()
  @IsBoolean()
  isBad?: boolean | null;

  @ApiPropertyOptional({
    example: null,
    nullable: true,
    type: Boolean,
    description:
      'Postavkada partiya muddati kuzatiladi (OMB-3). null — ota toifadan; BAD toifasida doim kuzatiladi',
  })
  @IsOptional()
  @IsBoolean()
  expiryTracked?: boolean | null;
}

export class UpdateCategoryDto extends PartialType(CreateCategoryDto) {}

export class CategoryDto {
  @ApiProperty({ example: '7' })
  id: string;

  @ApiProperty({ example: 'Mobil telefonlar' })
  name: string;

  @ApiProperty({ example: 'mobil-telefonlar' })
  slug: string;

  @ApiProperty({ example: '1', nullable: true, type: String })
  parentId: string | null;

  @ApiProperty({ example: null, nullable: true, type: String })
  iconUrl: string | null;

  @ApiProperty({ example: 10 })
  sortOrder: number;

  @ApiProperty({ example: true })
  isActive: boolean;

  @ApiProperty({
    example: null,
    nullable: true,
    type: Boolean,
    description: 'Toifaning o‘z belgisi; null — ota toifadan',
  })
  isBad: boolean | null;

  @ApiProperty({
    example: null,
    nullable: true,
    type: Boolean,
    description: 'Toifaning o‘z belgisi; null — ota toifadan',
  })
  expiryTracked: boolean | null;
}

export class CategoryTreeDto extends CategoryDto {
  @ApiProperty({ type: () => [CategoryTreeDto] })
  children: CategoryTreeDto[];
}
