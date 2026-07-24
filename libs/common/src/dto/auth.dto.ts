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
  @ApiProperty({ example: '+998901112233' })
  @Matches(PHONE_REGEX, PHONE_MSG)
  phone: string;

  @ApiProperty({ example: 'Secret123' })
  @IsString()
  password: string;
}

export class LogoutDto {
  @ApiProperty({
    description: 'Login yoki refresh orqali olingan refresh token',
  })
  @IsString()
  @MinLength(1)
  refreshToken: string;
}
