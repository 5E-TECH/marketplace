import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Ip,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
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
  AdminShipmentsQueryDto,
  AdminWebhooksQueryDto,
  CurrentUser,
  GeoSyncResultDto,
  JwtUser,
  MarketTariffSyncResultDto,
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
    @Inject(RmqClient.CHECKOUT) private readonly checkout: ClientProxy,
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

  @Post('markets/sync-tariffs')
  @ApiOperation({
    summary: 'Mavjud Elchi marketlari tariflarini catalog bilan sinxronlash',
  })
  @ApiOkResponse({ type: MarketTariffSyncResultDto })
  @ApiUnauthorizedResponse({ type: AuthErrorResponseDto })
  @ApiForbiddenResponse({ type: AuthErrorResponseDto })
  async syncMarketTariffs(@CurrentUser() admin: JwtUser, @Ip() ip: string) {
    const result = await sendRpc<MarketTariffSyncResultDto>(
      this.integration,
      { cmd: 'integration.market.sync-tariffs' },
      {},
    );
    void sendRpc(
      this.identity,
      { cmd: 'identity.audit.log' },
      {
        actorId: admin.sub,
        action: 'integration.market.sync-tariffs',
        entityType: 'ElchiMarketProvision',
        entityId: null,
        meta: { ip: ip ?? null, ...result },
      },
    ).catch(() => undefined);
    return result;
  }

  @Get('shipments')
  @ApiOperation({ summary: 'Elchi posilkalari holati va tracking ro‘yxati' })
  @ApiOkResponse({
    description: '{ items, total, page, limit, totalPages }',
  })
  shipments(@Query() query: AdminShipmentsQueryDto) {
    return sendRpc(
      this.checkout,
      { cmd: 'checkout.admin.integration.shipments-list' },
      { query },
    );
  }

  @Get('webhooks')
  @ApiOperation({ summary: 'Elchi webhook xabarlari tarixi' })
  @ApiOkResponse({
    description: '{ items, total, page, limit, totalPages }',
  })
  webhooks(@Query() query: AdminWebhooksQueryDto) {
    return sendRpc(
      this.checkout,
      { cmd: 'checkout.admin.integration.webhooks-list' },
      { query },
    );
  }

  @Post('shops/:id/reprovision')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Do‘konni Elchi marketida idempotent qayta provision',
  })
  @ApiOkResponse({
    description: '{ shopId, elchiMarketId, status, reprovisioned, error }',
  })
  async reprovision(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() admin: JwtUser,
    @Ip() ip: string,
  ) {
    const shopId = String(id);
    const result = await sendRpc(
      this.integration,
      { cmd: 'integration.market.reprovision' },
      { shopId },
    );
    void sendRpc(
      this.identity,
      { cmd: 'identity.audit.log' },
      {
        actorId: admin.sub,
        action: 'integration.market.reprovision',
        entityType: 'Shop',
        entityId: shopId,
        meta: { ip: ip ?? null, result },
      },
    ).catch(() => undefined);
    return result;
  }
}
