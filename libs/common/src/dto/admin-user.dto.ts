import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsIn,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Role } from '../enums';

const ADMIN_MANAGEABLE_ROLES = [
  Role.BUYER,
  Role.SELLER,
  Role.ADMIN,
  Role.SUPERADMIN,
] as const;

export class UpdateUserRoleDto {
  @ApiProperty({ enum: ADMIN_MANAGEABLE_ROLES, example: Role.SELLER })
  @IsIn(ADMIN_MANAGEABLE_ROLES)
  role: Role.BUYER | Role.SELLER | Role.ADMIN | Role.SUPERADMIN;
}

export class ImpersonatedUserDto {
  @ApiProperty({ example: '42' })
  id: string;

  @ApiProperty({ example: 'Ali Valiyev' })
  name: string;

  @ApiProperty({ enum: Role, example: Role.SELLER })
  role: Role;

  @ApiProperty({ example: '15', nullable: true })
  shopId: string | null;
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
  @ApiPropertyOptional({ enum: Role, example: Role.SELLER })
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
