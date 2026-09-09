import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Role } from '../enums';

const ADMIN_ROLES = [Role.ADMIN, Role.SUPERADMIN] as const;

export class CreateAdminTeamMemberDto {
  @ApiProperty({ example: 'Admin Operator' })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name: string;

  @ApiProperty({ example: '+998901112233' })
  @Matches(/^\+998\d{9}$/, {
    message: "phone +998XXXXXXXXX formatida bo'lishi kerak",
  })
  phone: string;

  @ApiProperty({ enum: ADMIN_ROLES, example: Role.ADMIN })
  @IsIn(ADMIN_ROLES)
  role: Role.ADMIN | Role.SUPERADMIN;

  @ApiPropertyOptional({
    minLength: 8,
    description: 'Berilmasa bir martalik vaqtinchalik parol yaratiladi',
  })
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password?: string;
}

export class UpdateAdminTeamRoleDto {
  @ApiProperty({ enum: ADMIN_ROLES, example: Role.ADMIN })
  @IsIn(ADMIN_ROLES)
  role: Role.ADMIN | Role.SUPERADMIN;
}

export class AdminTeamMemberDto {
  @ApiProperty({ example: '7' })
  id: string;

  @ApiProperty({ example: 'Admin Operator' })
  name: string;

  @ApiProperty({ example: '+998901112233' })
  phone: string;

  @ApiProperty({ enum: ADMIN_ROLES })
  role: Role.ADMIN | Role.SUPERADMIN;

  @ApiProperty({ example: true })
  isActive: boolean;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class CreateAdminTeamMemberResultDto extends AdminTeamMemberDto {
  @ApiPropertyOptional({
    description: 'Parol bodyda berilmagan bo‘lsa faqat shu javobda qaytadi',
  })
  temporaryPassword?: string;
}
