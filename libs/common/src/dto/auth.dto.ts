import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { Role } from '../enums';

const PHONE_REGEX = /^\+998\d{9}$/;
const PHONE_MSG = { message: "phone +998XXXXXXXXX formatida bo'lishi kerak" };

export class RegisterDto {
  @ApiProperty({ example: 'Akmal' })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name: string;

  @ApiProperty({ example: '+998901112233' })
  @Matches(PHONE_REGEX, PHONE_MSG)
  phone: string;

  @ApiProperty({ example: 'Secret123', minLength: 8 })
  @IsString()
  @MinLength(8)
  password: string;

  @ApiPropertyOptional({ example: 'akmal@example.com' })
  @IsOptional()
  @IsEmail()
  email?: string;

  // register orqali faqat SELLER/BUYER; ADMIN'lar seed/boshqa admin tomonidan
  @ApiPropertyOptional({ enum: Role, default: Role.BUYER })
  @IsOptional()
  @IsEnum(Role)
  role?: Role;
}

export class LoginDto {
  @ApiProperty({
    example: '+998900000000',
    description: 'Development SELLER telefon raqami',
  })
  @Matches(PHONE_REGEX, PHONE_MSG)
  phone: string;

  @ApiProperty({
    example: '0990',
    description: 'Development SELLER paroli',
  })
  @IsString()
  password: string;
}

export class RefreshTokenDto {
  @ApiPropertyOptional({
    description: 'Cookie ishlatilmasa refresh token body orqali yuboriladi',
  })
  @IsOptional()
  @IsString()
  refreshToken?: string;
}

export class ForgotPasswordDto {
  @ApiProperty({ example: '+998901112233' })
  @Matches(PHONE_REGEX, PHONE_MSG)
  phone: string;
}

export class ResetPasswordDto extends ForgotPasswordDto {
  @ApiProperty({ example: '123456' })
  @Matches(/^\d{6}$/, { message: 'code 6 xonali bo‘lishi kerak' })
  code: string;

  @ApiProperty({ example: 'NewSecret123', minLength: 8 })
  @IsString()
  @MinLength(8)
  newPassword: string;
}

export class VerifyPhoneDto extends ForgotPasswordDto {
  @ApiProperty({ example: '123456' })
  @Matches(/^\d{6}$/, { message: 'code 6 xonali bo‘lishi kerak' })
  code: string;
}

/** Barcha autentifikatsiyalangan rollar uchun o'z profilini tahrirlash DTO'si. */
export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'Ali Valiyev' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name?: string;

  @ApiPropertyOptional({ example: '+998901234567' })
  @IsOptional()
  @Matches(PHONE_REGEX, PHONE_MSG)
  phone?: string;

  @ApiPropertyOptional({ example: 'ali@example.com' })
  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  email?: string;

  @ApiPropertyOptional({ example: 'https://cdn.example.com/avatar.jpg' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  avatarUrl?: string;

  @ApiPropertyOptional({ example: '1234', minLength: 4 })
  @Transform(({ value }) =>
    typeof value === 'string' && value.trim() === '' ? undefined : value,
  )
  @IsOptional()
  @IsString()
  @MinLength(4)
  password?: string;
}

export class AuthUserDto {
  @ApiProperty({ example: '42' })
  id: string;

  @ApiProperty({ enum: Role, example: Role.BUYER })
  role: Role;

  @ApiProperty({ example: 'Akmal' })
  name: string;

  @ApiProperty({ example: '+998901112233' })
  phone: string;

  @ApiProperty({
    example: 'akmal@example.com',
    nullable: true,
    type: String,
  })
  email: string | null;

  @ApiProperty({ example: null, nullable: true, type: String })
  avatarUrl: string | null;

  @ApiProperty({ example: true })
  isActive: boolean;

  @ApiProperty({ example: false })
  isDeleted: boolean;

  @ApiProperty({ example: '2026-07-25T10:00:00.000Z', format: 'date-time' })
  createdAt: Date;

  @ApiProperty({ example: '2026-07-25T10:00:00.000Z', format: 'date-time' })
  updatedAt: Date;
}

export class AuthTokensDto {
  @ApiProperty({ type: AuthUserDto })
  user: AuthUserDto;

  @ApiProperty({
    description: 'Himoyalangan endpointlar uchun Bearer access token',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  accessToken: string;

  @ApiProperty({
    description: 'Sessiyani yangilash yoki logout qilish uchun refresh token',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  refreshToken: string;
}

export class AuthSuccessResponseDto {
  @ApiProperty({ example: 201 })
  statusCode: number;

  @ApiProperty({ example: 'OK' })
  message: string;

  @ApiProperty({ type: AuthTokensDto })
  data: AuthTokensDto;
}

export class LoginSuccessResponseDto {
  @ApiProperty({
    description: 'Himoyalangan endpointlar uchun Bearer access token',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  accessToken: string;
}

export class LogoutSuccessResponseDto {
  @ApiProperty({ example: 200 })
  statusCode: number;

  @ApiProperty({ example: 'OK' })
  message: string;

  @ApiProperty({
    description: 'Logout muvaffaqiyatli bajarilganda data null bo‘ladi',
    type: 'object',
    properties: {},
    example: null,
    nullable: true,
  })
  data: null;
}

export class ApiErrorDetailDto {
  @ApiProperty({ example: '' })
  field: string;

  @ApiProperty({ example: 'phone +998XXXXXXXXX formatida bo‘lishi kerak' })
  error: string;
}

export class AuthErrorResponseDto {
  @ApiProperty({ example: 400 })
  statusCode: number;

  @ApiProperty({
    oneOf: [
      { type: 'string', example: 'Telefon yoki parol xato' },
      {
        type: 'array',
        items: { type: 'string' },
        example: ['password must be longer than or equal to 8 characters'],
      },
    ],
  })
  message: string | string[];

  @ApiProperty({ example: 'VALIDATION_ERROR' })
  errorCode: string;

  @ApiPropertyOptional({ type: [ApiErrorDetailDto] })
  details?: ApiErrorDetailDto[];
}
