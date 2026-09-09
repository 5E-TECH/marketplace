import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Ip,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  AdminTeamMemberDto,
  AuthErrorResponseDto,
  CreateAdminTeamMemberDto,
  CreateAdminTeamMemberResultDto,
  CurrentUser,
  JwtUser,
  Role,
  Roles,
  RmqClient,
  sendRpc,
  UpdateAdminTeamRoleDto,
} from '@app/common';

@ApiTags('admin-team')
@ApiBearerAuth()
@Controller('admin/team')
export class AdminTeamController {
  constructor(
    @Inject(RmqClient.IDENTITY) private readonly identity: ClientProxy,
  ) {}

  @Get()
  @Roles(Role.SUPERADMIN)
  @ApiOperation({ summary: 'Admin jamoasi ro‘yxati' })
  @ApiOkResponse({ type: AdminTeamMemberDto, isArray: true })
  @ApiUnauthorizedResponse({ type: AuthErrorResponseDto })
  @ApiForbiddenResponse({ type: AuthErrorResponseDto })
  list(@CurrentUser() actor: JwtUser) {
    return sendRpc(
      this.identity,
      { cmd: 'identity.admin-team.list' },
      { actorId: actor.sub },
    );
  }

  @Post()
  @Roles(Role.SUPERADMIN)
  @ApiOperation({ summary: 'Admin jamoasiga a’zo qo‘shish' })
  @ApiCreatedResponse({ type: CreateAdminTeamMemberResultDto })
  @ApiConflictResponse({ description: 'Telefon allaqachon band' })
  create(
    @CurrentUser() actor: JwtUser,
    @Body() dto: CreateAdminTeamMemberDto,
    @Ip() ip: string,
  ) {
    return sendRpc(
      this.identity,
      { cmd: 'identity.admin-team.create' },
      { actorId: actor.sub, dto, ip },
    );
  }

  @Patch(':id/role')
  @Roles(Role.SUPERADMIN)
  @ApiOperation({ summary: 'Jamoa a’zosi rolini o‘zgartirish' })
  @ApiOkResponse({ type: AdminTeamMemberDto })
  @ApiConflictResponse({ description: 'Oxirgi SUPERADMIN himoyalangan' })
  updateRole(
    @CurrentUser() actor: JwtUser,
    @Param('id') id: string,
    @Body() dto: UpdateAdminTeamRoleDto,
    @Ip() ip: string,
  ) {
    return sendRpc(
      this.identity,
      { cmd: 'identity.admin-team.role.update' },
      { actorId: actor.sub, memberId: id, dto, ip },
    );
  }

  @Delete(':id')
  @Roles(Role.SUPERADMIN)
  @ApiOperation({ summary: 'Jamoa a’zosini o‘chirish' })
  @ApiOkResponse({ description: '{ id, removed: true }' })
  @ApiConflictResponse({ description: 'Oxirgi SUPERADMIN himoyalangan' })
  remove(
    @CurrentUser() actor: JwtUser,
    @Param('id') id: string,
    @Ip() ip: string,
  ) {
    return sendRpc(
      this.identity,
      { cmd: 'identity.admin-team.delete' },
      { actorId: actor.sub, memberId: id, ip },
    );
  }
}
