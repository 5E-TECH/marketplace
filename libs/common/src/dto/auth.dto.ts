import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Role } from '../enums';

const PHONE_REGEX = /^\+998\d{9}$/;
const PHONE_MSG = { message: "phone +998XXXXXXXXX formatida bo'lishi kerak" };

export class RegisterDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name: string;

  @Matches(PHONE_REGEX, PHONE_MSG)
  phone: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  // register orqali faqat SELLER/BUYER; ADMIN'lar seed/boshqa admin tomonidan
  @IsOptional()
  @IsEnum(Role)
  role?: Role;
}

export class LoginDto {
  @Matches(PHONE_REGEX, PHONE_MSG)
  phone: string;

  @IsString()
  password: string;
}
