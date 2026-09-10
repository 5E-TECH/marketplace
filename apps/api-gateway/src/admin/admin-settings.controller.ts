import { Body, Controller, Get, Inject, Ip, Put } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  AdminSettingsDto,
  AuthErrorResponseDto,
  CurrentUser,
  JwtUser,
  Role,
  Roles,
  RmqClient,
  sendRpc,
  UpdateAdminSettingsDto,
} from '@app/common';

/** C6.2 — platforma sozlamalarini panel orqali boshqarish. */
@ApiTags('admin-settings')
@ApiBearerAuth()
@Controller('admin/settings')
export class AdminSettingsController {
  constructor(
    @Inject(RmqClient.IDENTITY) private readonly identity: ClientProxy,
  ) {}

  @Get()
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  @ApiOperation({ summary: 'Joriy platforma sozlamalari' })
  @ApiOkResponse({ type: AdminSettingsDto })
  @ApiUnauthorizedResponse({ type: AuthErrorResponseDto })
  @ApiForbiddenResponse({ type: AuthErrorResponseDto })
  get() {
    return sendRpc(this.identity, { cmd: 'identity.settings.get' }, {});
  }

  @Put()
  @Roles(Role.SUPERADMIN)
  @ApiOperation({ summary: 'Platforma sozlamalarini yangilash' })
  @ApiOkResponse({ type: AdminSettingsDto })
  @ApiBadRequestResponse({ description: 'Sozlama qiymati noto‘g‘ri' })
  @ApiUnauthorizedResponse({ type: AuthErrorResponseDto })
  @ApiForbiddenResponse({ type: AuthErrorResponseDto })
  update(
    @CurrentUser() actor: JwtUser,
    @Body() dto: UpdateAdminSettingsDto,
    @Ip() ip: string,
  ) {
    return sendRpc(
      this.identity,
      { cmd: 'identity.settings.update' },
      { actorId: actor.sub, dto, ip },
    );
  }
}
