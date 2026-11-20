import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Role } from '../enums';

/** BE-05: SUPERADMIN foydalanuvchi rolini sakkiz roldan biriga almashtiradi (eski SELLER/BUYER — 400). */
export class UpdateUserRoleDto {
  @ApiProperty({ enum: Role, example: Role.OPERATOR_LEAD })
  @IsEnum(Role)
  role: Role;
}

export class ImpersonatedUserDto {
  @ApiProperty({ example: '42' })
  id: string;

  @ApiProperty({ example: 'Ali Valiyev' })
  name: string;

  @ApiProperty({ enum: Role, example: Role.AFFILIATE })
  role: Role;
}

export class ImpersonationResultDto {
  @ApiProperty({
    description: '15 daqiqalik, refresh qilib bo‘lmaydigan token',
  })
  impersonationToken: string;

  @ApiProperty({ example: 900 })
  expiresIn: number;

  @ApiProperty()
  expiresAt: Date;

  @ApiProperty({ type: ImpersonatedUserDto })
  user: ImpersonatedUserDto;
}

/** C1.29 — `GET /admin/users` — rol/blok/qidiruv filtri + sahifalash. */
export class AdminUsersQueryDto {
  @ApiPropertyOptional({ enum: Role, example: Role.AFFILIATE })
  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  @ApiPropertyOptional({ example: false, description: 'Bloklanganlar filtri' })
  @IsOptional()
  @Transform(({ value }) =>
    value === 'true' || value === true
      ? true
      : value === 'false' || value === false
        ? false
        : undefined,
  )
  @IsBoolean()
  blocked?: boolean;

  @ApiPropertyOptional({ example: 'Ali' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  search?: string;

  @ApiPropertyOptional({ example: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ example: 20, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}
