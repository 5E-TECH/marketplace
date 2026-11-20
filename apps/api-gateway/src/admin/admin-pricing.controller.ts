import {
  Body,
  Controller,
  Get,
  Inject,
  Ip,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  CurrentUser,
  ElchiTariffDto,
  JwtUser,
  MarketCheckDto,
  PriceDecisionDto,
  PriceDecisionViewDto,
  PricePolicyDto,
  PricingQueryDto,
  ProductPricePolicyDto,
  RmqClient,
  Role,
  Roles,
  sendRpc,
} from '@app/common';
import { ParseLeadIdPipe } from '../leads/lead-id.pipe';

/**
 * BE-09: narx kalkulyatori (TZ 2-bo‘lim, 6.13). Mahsulot narxini tasdiqlash — admin (TZ 3: «Mahsulot, narx va
 * kreativni tasdiqlash»); kalkulyator sozlamalari va Elchi tarifi — faqat superadmin (TZ 3: «Narx kalkulyatori …
 * sozlamalari»). Har o‘zgarish audit jurnalida (TZ 2.6, ADM-6).
 */
@ApiTags('admin-pricing')
@ApiBearerAuth()
@Controller('admin')
export class AdminPricingController {
  constructor(
    @Inject(RmqClient.CATALOG) private readonly catalog: ClientProxy,
    @Inject(RmqClient.IDENTITY) private readonly identity: ClientProxy,
  ) {}

  @Get('products/:id/pricing')
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  @ApiOperation({
    summary:
      'Narx hisobi: tavsiya, zararsizlik, qat’iy chegara, taqsimot, holat (NRX-2)',
    description:
      '`price` va `affiliateFee` berilsa — shu qiymatlar bilan qayta hisoblanadi (tasdiqlashdan oldin).',
  })
  calculate(
    @Param('id', ParseLeadIdPipe) id: string,
    @Query() query: PricingQueryDto,
  ) {
    return sendRpc(
      this.catalog,
      { cmd: 'catalog.pricing.calculate' },
      { productId: id, query },
    );
  }

  @Post('products/:id/price-decision')
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  @ApiOperation({
    summary:
      'Narxni tasdiqlash (NRX-6): qizil — 400; to‘q sariq — sabab majburiy, superadminga xabar',
  })
  async decide(
    @Param('id', ParseLeadIdPipe) id: string,
    @Body() dto: PriceDecisionDto,
    @CurrentUser() admin: JwtUser,
    @Ip() ip: string,
  ) {
    const result = await sendRpc<{ decision: { id: string; status: string } }>(
      this.catalog,
      { cmd: 'catalog.pricing.decide' },
      { productId: id, actorId: admin.sub, dto },
    );
    this.audit(admin.sub, 'price.decision', 'Product', id, ip, {
      ...dto,
      status: result.decision.status,
      decisionId: result.decision.id,
    });
    return result;
  }

  @Get('products/:id/price-decisions')
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  @ApiOperation({ summary: 'Narx qarorlari tarixi: kim, qachon, holat, sabab' })
  @ApiOkResponse({ type: [PriceDecisionViewDto] })
  history(@Param('id', ParseLeadIdPipe) id: string) {
    return sendRpc(
      this.catalog,
      { cmd: 'catalog.pricing.history' },
      { productId: id },
    );
  }

  @Post('products/:id/market-check')
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  @ApiOperation({
    summary:
      'Bozor narxi tekshiruvi (NRX-5): «mos»/«qimmat» va optovik uchun eng yuqori bazaviy narx',
  })
  async market(
    @Param('id', ParseLeadIdPipe) id: string,
    @Body() dto: MarketCheckDto,
    @CurrentUser() admin: JwtUser,
    @Ip() ip: string,
  ) {
    const result = await sendRpc(
      this.catalog,
      { cmd: 'catalog.pricing.market-check' },
      { productId: id, dto },
    );
    this.audit(admin.sub, 'price.market-check', 'Product', id, ip, { ...dto });
    return result;
  }

  @Put('products/:id/price-policy')
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  @ApiOperation({
    summary:
      'Mahsulot darajasidagi sozlama: faqat yetkazish rejimi va ko‘rinadigan summa (TZ 2.4, NRX-8); null — yuqori darajadan. Pul parametrlari — superadmin',
  })
  setProductPolicy(
    @Param('id', ParseLeadIdPipe) id: string,
    @Body() dto: ProductPricePolicyDto,
    @CurrentUser() admin: JwtUser,
    @Ip() ip: string,
  ) {
    return this.setPolicy('PRODUCT', id, dto, admin, ip);
  }

  @Get('pricing/policy')
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  @ApiOperation({
    summary:
      'Global narx sozlamasi (K, M, foizlar, sotuvchi haqi koeffitsienti, yetkazish)',
  })
  getGlobal() {
    return sendRpc(
      this.catalog,
      { cmd: 'catalog.pricing.policy-get' },
      { scope: 'GLOBAL' },
    );
  }

  @Put('pricing/policy')
  @Roles(Role.SUPERADMIN)
  @ApiOperation({ summary: 'Global narx sozlamasini o‘zgartirish (ADM-2)' })
  setGlobal(
    @Body() dto: PricePolicyDto,
    @CurrentUser() admin: JwtUser,
    @Ip() ip: string,
  ) {
    return this.setPolicy('GLOBAL', null, dto, admin, ip);
  }

  @Get('pricing/policy/categories/:id')
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  @ApiOperation({ summary: 'Kategoriya darajasidagi narx sozlamasi' })
  getCategory(@Param('id', ParseLeadIdPipe) id: string) {
    return sendRpc(
      this.catalog,
      { cmd: 'catalog.pricing.policy-get' },
      { scope: 'CATEGORY', scopeId: id },
    );
  }

  @Put('pricing/policy/categories/:id')
  @Roles(Role.SUPERADMIN)
  @ApiOperation({
    summary: 'Kategoriya darajasidagi narx sozlamasi (null — globaldan)',
  })
  setCategory(
    @Param('id', ParseLeadIdPipe) id: string,
    @Body() dto: PricePolicyDto,
    @CurrentUser() admin: JwtUser,
    @Ip() ip: string,
  ) {
    return this.setPolicy('CATEGORY', id, dto, admin, ip);
  }

  @Get('pricing/elchi-tariffs')
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  @ApiOperation({ summary: 'Elchi tariflari tarixi (NRX-7)' })
  tariffs() {
    return sendRpc(this.catalog, { cmd: 'catalog.pricing.tariff-list' }, {});
  }

  @Post('pricing/elchi-tariffs')
  @Roles(Role.SUPERADMIN)
  @ApiOperation({
    summary:
      'Yangi Elchi tarifi kuchga kirish vaqti bilan (NRX-7); yaratilgan buyurtmalarga ta’sir qilmaydi',
  })
  async addTariff(
    @Body() dto: ElchiTariffDto,
    @CurrentUser() admin: JwtUser,
    @Ip() ip: string,
  ) {
    const row = await sendRpc<{ id: string }>(
      this.catalog,
      { cmd: 'catalog.pricing.tariff-add' },
      { dto, actorId: admin.sub },
    );
    this.audit(
      admin.sub,
      'pricing.elchi-tariff.add',
      'ElchiTariff',
      String(row.id),
      ip,
      { ...dto },
    );
    return row;
  }

  private async setPolicy(
    scope: 'GLOBAL' | 'CATEGORY' | 'PRODUCT',
    scopeId: string | null,
    dto: PricePolicyDto,
    admin: JwtUser,
    ip: string,
  ) {
    const result = await sendRpc<{ before: unknown; after: unknown }>(
      this.catalog,
      { cmd: 'catalog.pricing.policy-set' },
      { scope, scopeId, dto, actorId: admin.sub },
    );
    this.audit(
      admin.sub,
      'pricing.policy.update',
      'PricePolicy',
      scopeId ?? 'GLOBAL',
      ip,
      {
        scope,
        before: result.before,
        after: result.after,
      },
    );
    return result.after;
  }

  private audit(
    actorId: string,
    action: string,
    entityType: string,
    entityId: string,
    ip: string | undefined,
    meta: Record<string, unknown>,
  ): void {
    void sendRpc(
      this.identity,
      { cmd: 'identity.audit.log' },
      {
        actorId,
        action,
        entityType,
        entityId,
        meta: { ...meta, ip: ip ?? null },
      },
    ).catch(() => undefined);
  }
}
