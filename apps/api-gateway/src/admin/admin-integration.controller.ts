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
import {
  ADMIN_INTEGRATION_SHIPMENTS_PAGE_EXAMPLE,
  ADMIN_INTEGRATION_WEBHOOKS_PAGE_EXAMPLE,
} from './admin-m1.examples';

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
  @ApiOperation({
    summary: 'Elchi posilkalari va Elchi’ga topshirilmagan buyurtmalar',
    description:
      '`shipmentState`: `all` (sukut), `created` — posilkasi bor, ' +
      '`missing` — tasdiqlangan/to‘langan, lekin posilkasi yaratilmagan ' +
      '(qotib qolgan). Qatorda `orderStatus` va `paymentMethod` ham bor.',
  })
  @ApiOkResponse({
    description:
      'Posilka (`shipmentId` — Elchi raqami, yaratilmagan bo‘lsa null) va buyurtma holati; summa butun so‘m',
    schema: { example: ADMIN_INTEGRATION_SHIPMENTS_PAGE_EXAMPLE },
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
    description:
      '`result`: APPLIED, NOOP, REJECTED, IGNORED (webhook javobidagi kabi); `payload` — Elchi yuborgan xabar',
    schema: { example: ADMIN_INTEGRATION_WEBHOOKS_PAGE_EXAMPLE },
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
