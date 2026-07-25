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
    description: 'Development SUPERADMIN telefon raqami',
  })
  @Matches(PHONE_REGEX, PHONE_MSG)
  phone: string;

  @ApiProperty({
    example: '0990',
    description: 'Development SUPERADMIN paroli',
  })
  @IsString()
  password: string;
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
