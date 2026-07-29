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

  @ApiPropertyOptional({ example: '1', nullable: true })
  @IsOptional()
  @Matches(/^\d+$/, { message: "parentId musbat son bo'lishi kerak" })
  parentId?: string | null;

  @ApiPropertyOptional({
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
}

export class CategoryTreeDto extends CategoryDto {
  @ApiProperty({ type: () => [CategoryTreeDto] })
  children: CategoryTreeDto[];
}
