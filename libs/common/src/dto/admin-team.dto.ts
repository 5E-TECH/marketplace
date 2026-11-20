import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Role, STAFF_ROLES } from '../enums';

/** BE-05: jamoa — platforma xodimlari (operator, nazoratchi, omborchi, moliya, admin, superadmin). */
const TEAM_ROLES = STAFF_ROLES;
type TeamRole = (typeof STAFF_ROLES)[number];

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

  @ApiProperty({ enum: TEAM_ROLES, example: Role.OPERATOR_LEAD })
  @IsIn(TEAM_ROLES)
  role: TeamRole;

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
  @ApiProperty({ enum: TEAM_ROLES, example: Role.OPERATOR_LEAD })
  @IsIn(TEAM_ROLES)
  role: TeamRole;
}

export class AdminTeamMemberDto {
  @ApiProperty({ example: '7' })
  id: string;

  @ApiProperty({ example: 'Admin Operator' })
  name: string;

  @ApiProperty({ example: '+998901112233' })
  phone: string;

  @ApiProperty({ enum: TEAM_ROLES })
  role: TeamRole;

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
