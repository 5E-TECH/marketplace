import { Controller, Inject, Ip, Post } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  AuthErrorResponseDto,
  CurrentUser,
  GeoSyncResultDto,
  JwtUser,
  Role,
  Roles,
  RmqClient,
  sendRpc,
} from '@app/common';

/** C1.44 — Elchi hududlar keshini admin tomonidan boshqarish. */
@ApiTags('admin-integration')
@ApiBearerAuth()
@Roles(Role.ADMIN, Role.SUPERADMIN)
@Controller('admin/integration')
export class AdminIntegrationController {
  constructor(
    @Inject(RmqClient.INTEGRATION) private readonly integration: ClientProxy,
    @Inject(RmqClient.IDENTITY) private readonly identity: ClientProxy,
  ) {}

  @Post('geo/sync')
  @ApiOperation({ summary: 'Elchi viloyat/tuman keshini hozir sinxronlash' })
  @ApiOkResponse({ type: GeoSyncResultDto })
  @ApiUnauthorizedResponse({ type: AuthErrorResponseDto })
  @ApiForbiddenResponse({ type: AuthErrorResponseDto })
  async syncGeo(@CurrentUser() admin: JwtUser, @Ip() ip: string) {
    const result = await sendRpc<GeoSyncResultDto>(
      this.integration,
      { cmd: 'integration.geo.sync' },
      {},
    );
    void sendRpc(
      this.identity,
      { cmd: 'identity.audit.log' },
      {
        actorId: admin.sub,
        action: 'integration.geo.sync',
        entityType: 'GeoCache',
        entityId: null,
        meta: { ip: ip ?? null, ...result },
      },
    ).catch(() => undefined);
    return result;
  }
}
