import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { ShopStatus, WholesalerLegalType } from '../enums';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * BE-07 (OPT-1): optovikni admin kiritadi (FE-25), foydalanuvchisiz. Rekvizitlar formati O‘zbekiston bo‘yicha:
 * STIR 9 raqam, hisob raqami 20 raqam, bank MFO 5 raqam.
 */
export class CreateWholesalerDto {
  @ApiProperty({ example: 'Gadget Trade MChJ' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name: string;

  @ApiProperty({
    enum: WholesalerLegalType,
    example: WholesalerLegalType.LEGAL_ENTITY,
  })
  @IsEnum(WholesalerLegalType)
  legalType: WholesalerLegalType;

  @ApiProperty({ example: '305123456', description: 'STIR, 9 raqam' })
  @Matches(/^\d{9}$/, { message: 'STIR 9 raqamdan iborat bo‘lishi kerak' })
  tin: string;

  @ApiProperty({ example: 'Kapitalbank' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  bankName: string;

  @ApiProperty({
    example: '20208000900123456001',
    description: 'Hisob raqami, 20 raqam',
  })
  @Matches(/^\d{20}$/, {
    message: 'Hisob raqami 20 raqamdan iborat bo‘lishi kerak',
  })
  bankAccount: string;

  @ApiProperty({ example: '01158', description: 'Bank MFO, 5 raqam' })
  @Matches(/^\d{5}$/, { message: 'MFO 5 raqamdan iborat bo‘lishi kerak' })
  bankMfo: string;

  @ApiProperty({
    example: 'K-2026/014',
    description: 'Komissiya shartnomasi raqami',
  })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  contractNumber: string;

  @ApiProperty({
    example: '2026-11-20',
    description: 'Shartnoma sanasi (YYYY-MM-DD)',
  })
  @IsISO8601({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'contractDate YYYY-MM-DD bo‘lishi kerak',
  })
  contractDate: string;

  @ApiPropertyOptional({ example: '+998901234567' })
  @IsOptional()
  @Matches(/^\+998\d{9}$/, {
    message: "phone +998XXXXXXXXX formatida bo'lishi kerak",
  })
  phone?: string;

  @ApiPropertyOptional({ example: 'Toshkent, Chilonzor 5' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  address?: string;

  @ApiPropertyOptional({ example: 'Maishiy texnika optovigi' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;
}

/** `null` qabul qilinmaydi (`skipNullProperties: false`): shartnoma yoki nomni bo‘sh qilib bo‘lmaydi. */
export class UpdateWholesalerDto extends PartialType(CreateWholesalerDto, {
  skipNullProperties: false,
}) {
  @ApiPropertyOptional({
    enum: [ShopStatus.ACTIVE, ShopStatus.SUSPENDED],
    description: 'To‘xtatilgan optovik offerlari sotuvdan olinadi',
  })
  @IsOptional()
  @IsIn([ShopStatus.ACTIVE, ShopStatus.SUSPENDED])
  status?: ShopStatus.ACTIVE | ShopStatus.SUSPENDED;
}

export class AdminWholesalersQueryDto {
  @ApiPropertyOptional({
    example: 'gadget',
    description: 'Nom yoki STIR bo‘yicha',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

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

export class WholesalerDto {
  @ApiProperty({ example: '15' }) id: string;
  @ApiProperty({ example: 'Gadget Trade MChJ' }) name: string;
  @ApiProperty({ example: 'gadget-trade-mchj-15' }) slug: string;
  @ApiProperty({ enum: ShopStatus }) status: ShopStatus;
  @ApiProperty({ enum: WholesalerLegalType, nullable: true })
  legalType: WholesalerLegalType | null;
  @ApiProperty({ example: '305123456', nullable: true, type: String }) tin:
    string | null;
  @ApiProperty({ example: 'Kapitalbank', nullable: true, type: String })
  bankName: string | null;
  @ApiProperty({
    example: '20208000900123456001',
    nullable: true,
    type: String,
  })
  bankAccount: string | null;
  @ApiProperty({ example: '01158', nullable: true, type: String }) bankMfo:
    string | null;
  @ApiProperty({ example: 'K-2026/014', nullable: true, type: String })
  contractNumber: string | null;
  @ApiProperty({ example: '2026-11-20', nullable: true, type: String })
  contractDate: string | null;
  @ApiProperty({ example: '+998901234567', nullable: true, type: String })
  phone: string | null;
  @ApiProperty({ nullable: true, type: String }) address: string | null;
  @ApiProperty({ nullable: true, type: String }) description: string | null;
  @ApiProperty({
    example: null,
    nullable: true,
    type: String,
    description: 'Optovik kabineti foydalanuvchisi (BE-30)',
  })
  ownerUserId: string | null;
  @ApiProperty() createdAt: Date;
}

export class WholesalerPageDto {
  @ApiProperty({ type: [WholesalerDto] }) items: WholesalerDto[];
  @ApiProperty({ example: 3 }) total: number;
  @ApiProperty({ example: 1 }) page: number;
  @ApiProperty({ example: 20 }) limit: number;
  @ApiProperty({ example: 1 }) totalPages: number;
}
