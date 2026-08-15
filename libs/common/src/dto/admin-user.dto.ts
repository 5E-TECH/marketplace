import { ApiPropertyOptional } from '@nestjs/swagger';
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
