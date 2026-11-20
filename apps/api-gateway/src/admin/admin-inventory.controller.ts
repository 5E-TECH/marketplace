import { Body, Controller, Get, Inject, Ip, Post, Query } from '@nestjs/common';
import { randomUUID } from 'crypto';
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
  AdminStockAdjustDto,
  AdminStockInboundDto,
  AdminStockMovementsPageDto,
  AdminStockMovementsQueryDto,
  AdminStockPageDto,
  AdminStockQueryDto,
  AuthErrorResponseDto,
  CurrentUser,
  JwtUser,
  Role,
  Roles,
  RmqClient,
  sendRpc,
} from '@app/common';

@ApiTags('admin-inventory')
@ApiBearerAuth()
// TZ 3: qoldiqni ko‘rish — omborchi va admin (BE-05)
@Roles(Role.ADMIN, Role.WAREHOUSE, Role.SUPERADMIN)
@Controller('admin/inventory')
export class AdminInventoryController {
  constructor(
    @Inject(RmqClient.INVENTORY) private readonly inventory: ClientProxy,
    @Inject(RmqClient.IDENTITY) private readonly identity: ClientProxy,
  ) {}

  @Post('inbound')
  @ApiOperation({
    summary: 'HQ omborga kirim (omborchi) — BE-16; to‘liq qabul akti BE-17 da',
  })
  async inbound(
    @Body() dto: AdminStockInboundDto,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
  ) {
    const result = await sendRpc(
      this.inventory,
      { cmd: 'inventory.hq.inbound' },
      {
        variantId: dto.variantId,
        quantity: dto.quantity,
        reason: dto.reason,
        actorId: user.sub,
        idempotencyKey: dto.idempotencyKey ?? randomUUID(),
      },
    );
    this.audit(user.sub, 'inventory.hq.inbound', dto.variantId, ip, { ...dto });
    return result;
  }

  @Post('adjust')
  @ApiOperation({
    summary:
      'HQ qoldig‘ini tuzatish (inventarizatsiya); band qilingandan kam bo‘lmaydi',
  })
  async adjust(
    @Body() dto: AdminStockAdjustDto,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
  ) {
    const result = await sendRpc(
      this.inventory,
      { cmd: 'inventory.hq.adjust' },
      {
        variantId: dto.variantId,
        delta: dto.delta,
        reason: dto.reason,
        actorId: user.sub,
        idempotencyKey: dto.idempotencyKey ?? randomUUID(),
      },
    );
    this.audit(user.sub, 'inventory.hq.adjust', dto.variantId, ip, { ...dto });
    return result;
  }

  private audit(
    actorId: string,
    action: string,
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
        entityType: 'Stock',
        entityId,
        meta: { ...meta, ip: ip ?? null },
      },
    ).catch(() => undefined);
  }

  @Get('stock')
  @ApiOperation({ summary: 'Butun platformadagi sotuvchilar qoldig‘i' })
  @ApiOkResponse({ type: AdminStockPageDto })
  @ApiUnauthorizedResponse({ type: AuthErrorResponseDto })
  @ApiForbiddenResponse({ type: AuthErrorResponseDto })
  stock(@Query() query: AdminStockQueryDto) {
    return sendRpc(
      this.inventory,
      { cmd: 'inventory.admin.stock-list' },
      { query },
    );
  }

  @Get('movements')
  @ApiOperation({ summary: 'Butun platformadagi qoldiq harakati jurnali' })
  @ApiOkResponse({ type: AdminStockMovementsPageDto })
  @ApiUnauthorizedResponse({ type: AuthErrorResponseDto })
  @ApiForbiddenResponse({ type: AuthErrorResponseDto })
  movements(@Query() query: AdminStockMovementsQueryDto) {
    return sendRpc(
      this.inventory,
      { cmd: 'inventory.admin.movements-list' },
      { query },
    );
  }
}
