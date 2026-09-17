import {
  Body,
  Controller,
  Get,
  Inject,
  Ip,
  Param,
  Post,
  Query,
  Patch,
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
  AdminShopsQueryDto,
  AdminShopDetailDto,
  AuthErrorResponseDto,
  CurrentUser,
  FeatureShopDto,
  JwtUser,
  RejectShopDto,
  Role,
  Roles,
  RmqClient,
  sendRpc,
  UpdateShopTariffsDto,
} from '@app/common';

interface ApprovedShop {
  id: string;
  ownerUserId: string;
  name: string;
  phone?: string | null;
  regionId?: string | null;
  districtId?: string | null;
  tariffHome: number;
  tariffCenter: number;
  elchiMarketId?: string | null;
}

/**
 * Admin do'kon moderatsiyasi (C1.7). Global JwtAuthGuard + RolesGuard bor —
 * shu bois faqat `@Roles(ADMIN, SUPERADMIN)` yetarli (boshqa rol → 403).
 * approve: catalog (ACTIVE + shop.approved event) → identity (user active) →
 * inventory (default ombor). Market provisioning shop.approved orqali
 * elchi-integration'da (C1.6, async).
 */
@ApiTags('admin-shops')
@Controller()
export class AdminShopsController {
  constructor(
    @Inject(RmqClient.CATALOG) private readonly catalog: ClientProxy,
    @Inject(RmqClient.IDENTITY) private readonly identity: ClientProxy,
    @Inject(RmqClient.INVENTORY) private readonly inventory: ClientProxy,
    @Inject(RmqClient.CHECKOUT) private readonly checkout: ClientProxy,
    @Inject(RmqClient.INTEGRATION) private readonly integration: ClientProxy,
  ) {}

  @Get('admin/shops')
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Do‘konlar ro‘yxati (status filtr + sahifalash)' })
  @ApiOkResponse({ description: '{ items, total, page, limit, totalPages }' })
  @ApiUnauthorizedResponse({ type: AuthErrorResponseDto })
  @ApiForbiddenResponse({ type: AuthErrorResponseDto })
  list(@Query() query: AdminShopsQueryDto) {
    return sendRpc(this.catalog, { cmd: 'catalog.shop.admin-list' }, { query });
  }

  @Get('admin/shops/:id')
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  @ApiBearerAuth()
  @ApiOkResponse({ type: AdminShopDetailDto })
  @ApiOperation({ summary: 'Do‘kon profili va asosiy statistikasi' })
  async detail(@Param('id') id: string) {
    const [catalog, orders, warehouses] = await Promise.all([
      sendRpc<{ shop: Omit<AdminShopDetailDto, 'stats'>; products: number }>(
        this.catalog,
        { cmd: 'catalog.shop.admin-detail' },
        { shopId: id },
      ),
      sendRpc<number>(
        this.checkout,
        { cmd: 'checkout.orders.count-by-shop' },
        { shopId: id },
      ),
      sendRpc<number>(
        this.inventory,
        { cmd: 'inventory.warehouse.count-by-shop' },
        { shopId: id },
      ),
    ]);
    return {
      ...catalog.shop,
      stats: { products: catalog.products, orders, warehouses },
    };
  }

  @Post('admin/shops/:id/suspend')
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'ACTIVE do‘konni vaqtincha to‘xtatish' })
  async suspend(
    @Param('id') id: string,
    @CurrentUser() admin: JwtUser,
    @Ip() ip: string,
  ) {
    const result = await sendRpc(
      this.catalog,
      { cmd: 'catalog.shop.suspend' },
      { shopId: id },
    );
    this.audit(admin?.sub, 'shop.suspend', 'Shop', id, ip);
    return result;
  }

  @Post('admin/shops/:id/activate')
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'SUSPENDED do‘konni qayta faollashtirish' })
  async activate(
    @Param('id') id: string,
    @CurrentUser() admin: JwtUser,
    @Ip() ip: string,
  ) {
    const result = await sendRpc(
      this.catalog,
      { cmd: 'catalog.shop.activate' },
      { shopId: id },
    );
    this.audit(admin?.sub, 'shop.activate', 'Shop', id, ip);
    return result;
  }

  @Post('admin/shops/:id/feature')
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Do‘konni bosh sahifada ko‘rsatish/yashirish' })
  async feature(
    @Param('id') id: string,
    @Body() dto: FeatureShopDto,
    @CurrentUser() admin: JwtUser,
    @Ip() ip: string,
  ) {
    const result = await sendRpc(
      this.catalog,
      { cmd: 'catalog.shop.feature' },
      { shopId: id, featured: dto.featured },
    );
    this.audit(admin?.sub, 'shop.feature.update', 'Shop', id, ip, {
      featured: dto.featured,
    });
    return result;
  }

  @Patch('admin/shops/:id/tariffs')
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Do‘konning Elchi yetkazish tariflarini sozlash/sinxronlash',
  })
  async updateTariffs(
    @Param('id') id: string,
    @Body() dto: UpdateShopTariffsDto,
    @CurrentUser() admin: JwtUser,
    @Ip() ip: string,
  ) {
    const result = await sendRpc(
      this.catalog,
      { cmd: 'catalog.shop.update-tariffs' },
      { shopId: id, ...dto },
    );
    const shop = result as ApprovedShop;
    if (shop.elchiMarketId) {
      await sendRpc(
        this.integration,
        { cmd: 'integration.market.update-tariffs' },
        {
          shopId: shop.id,
          shopName: shop.name,
          phone: shop.phone ?? null,
          regionId: shop.regionId ?? null,
          districtId: shop.districtId ?? null,
          tariffHome: dto.tariffHome,
          tariffCenter: dto.tariffCenter,
        },
      );
    }
    this.audit(admin?.sub, 'shop.tariffs.update', 'Shop', id, ip, {
      tariffHome: dto.tariffHome,
      tariffCenter: dto.tariffCenter,
    });
    return result;
  }

  @Post('admin/shops/:id/approve')
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Do‘konni tasdiqlash (active + user active + default ombor)',
  })
  @ApiForbiddenResponse({ type: AuthErrorResponseDto })
  async approve(
    @Param('id') id: string,
    @CurrentUser() admin: JwtUser,
    @Ip() ip: string,
  ): Promise<ApprovedShop> {
    // 1) catalog: shop ACTIVE (event HALI emas — avval lokal holat izchil bo'lsin)
    const shop = await sendRpc<ApprovedShop>(
      this.catalog,
      { cmd: 'catalog.shop.approve' },
      { shopId: id },
    );
    // 2) identity: sotuvchi userni faollashtirish
    await sendRpc(
      this.identity,
      { cmd: 'identity.user.set-active' },
      { userId: shop.ownerUserId, isActive: true },
    );
    // 3) inventory: default ombor (idempotent)
    await sendRpc(
      this.inventory,
      { cmd: 'inventory.warehouse.ensure-default' },
      {
        shopId: shop.id,
        name: `${shop.name} ombori`,
        regionId: shop.regionId ?? null,
        districtId: shop.districtId ?? null,
      },
    );
    // 4) EMIT OXIRIDA: user faol + ombor tayyor bo'lgach `shop.approved`
    //    (notification + elchi-integration provisioning). Consumer'lar idempotent,
    //    shu bois yarim-bajarilgan approve qayta chaqirilsa xavfsiz.
    await sendRpc(
      this.catalog,
      { cmd: 'catalog.shop.publish-approved' },
      {
        sellerUserId: shop.ownerUserId,
        shopId: shop.id,
        shopName: shop.name,
        phone: shop.phone ?? null,
        regionId: shop.regionId ?? null,
        districtId: shop.districtId ?? null,
        tariffHome: Number(shop.tariffHome ?? 0),
        tariffCenter: Number(shop.tariffCenter ?? 0),
      },
    );
    // C1.31 — audit (best-effort): approve muvaffaqiyatidan so'ng.
    this.audit(admin?.sub, 'shop.approve', 'Shop', id, ip);
    return shop;
  }

  @Post('admin/shops/:id/reject')
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Do‘konni rad etish (+ sotuvchiga xabar)' })
  @ApiForbiddenResponse({ type: AuthErrorResponseDto })
  async reject(
    @Param('id') id: string,
    @Body() dto: RejectShopDto,
    @CurrentUser() admin: JwtUser,
    @Ip() ip: string,
  ) {
    const res = await sendRpc(
      this.catalog,
      { cmd: 'catalog.shop.reject' },
      { shopId: id, reason: dto?.reason },
    );
    this.audit(admin?.sub, 'shop.reject', 'Shop', id, ip, {
      reason: dto?.reason ?? null,
    });
    return res;
  }

  /** C1.31 — audit sink'ga best-effort yozadi (xatoda amalни buzmaydi). */
  private audit(
    actorId: string | undefined,
    action: string,
    entityType: string,
    entityId: string,
    ip?: string,
    extra?: Record<string, unknown>,
  ): void {
    void sendRpc(
      this.identity,
      { cmd: 'identity.audit.log' },
      {
        actorId: actorId ?? null,
        action,
        entityType,
        entityId,
        meta: { ip: ip ?? null, ...(extra ?? {}) },
      },
    ).catch(() => undefined);
  }
}
