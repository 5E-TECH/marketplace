import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Ip,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  AdminOrderActionDto,
  CurrentUser,
  JwtUser,
  LEAD_ORDER_RPC,
  LeadOrderActorType,
  OperatorOrdersQueryDto,
  OrderActionResultDto,
  RmqClient,
  Role,
  Roles,
  sendRpc,
} from '@app/common';
import {
  OPERATOR_ORDER_EXAMPLE,
  OPERATOR_ORDERS_PAGE_EXAMPLE,
} from '../admin/admin-m1.examples';
import { ParseLeadIdPipe } from './lead-id.pipe';

/**
 * Operator va nazoratchi buyurtmani bekor qiladi (BE-18, TZ BUY-3): Elchi’ga topshirilgunga qadar, sabab bilan;
 * band tovar darhol bo‘shaydi. Topshirilgan yoki yo‘ldagi buyurtma — 409 va holat jurnalida.
 */
@ApiTags('operator')
@Roles(Role.OPERATOR_LEAD, Role.SUPERVISOR, Role.SUPERADMIN)
@ApiBearerAuth()
@Controller('operator/orders')
export class OperatorOrdersController {
  constructor(
    @Inject(RmqClient.CHECKOUT) private readonly checkout: ClientProxy,
    @Inject(RmqClient.IDENTITY) private readonly identity: ClientProxy,
  ) {}

  @Get()
  @Roles(Role.OPERATOR_LEAD)
  @ApiOperation({
    summary: 'Mening buyurtmalarim: operator o‘zi tasdiqlagan buyurtmalar',
    description:
      'Telefon niqoblangan; qidiruv — buyurtma raqami yoki ism. `facets.products` — «Mahsulot» filtri. Sotuvchi va sahifa ko‘rinmaydi.',
  })
  @ApiOkResponse({
    description: '{ items, total, page, limit, totalPages, counts?, facets }',
    schema: { example: OPERATOR_ORDERS_PAGE_EXAMPLE },
  })
  list(@Query() query: OperatorOrdersQueryDto, @CurrentUser() user: JwtUser) {
    return sendRpc(
      this.checkout,
      { cmd: 'checkout.admin.orders-list' },
      { query, viewer: { kind: 'OPERATOR', userId: String(user.sub) } },
    );
  }

  @Get(':id')
  @Roles(Role.OPERATOR_LEAD)
  @ApiOperation({ summary: 'O‘zi tasdiqlagan buyurtma kartasi' })
  @ApiOkResponse({
    description:
      'Admin kartasi bilan bir xil shakl; to‘liq telefon, narx tarkibi, sotuvchi va sahifa yo‘q',
    schema: { example: OPERATOR_ORDER_EXAMPLE },
  })
  @ApiNotFoundResponse({
    description: 'Buyurtma topilmadi yoki boshqa operatorniki',
  })
  get(@Param('id', ParseLeadIdPipe) id: string, @CurrentUser() user: JwtUser) {
    return sendRpc(
      this.checkout,
      { cmd: 'checkout.admin.order-get' },
      {
        orderId: id,
        viewer: { kind: 'OPERATOR', userId: String(user.sub) },
      },
    );
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Buyurtmani bekor qilish (sabab bilan)' })
  @ApiOkResponse({ type: OrderActionResultDto })
  @ApiBadRequestResponse({ description: 'Sabab yo‘q' })
  @ApiNotFoundResponse({ description: 'Buyurtma topilmadi' })
  @ApiConflictResponse({
    description: 'errorCode INVALID_STATE — buyurtma Elchi’ga topshirilgan',
  })
  async cancel(
    @Param('id', ParseLeadIdPipe) id: string,
    @Body() dto: AdminOrderActionDto,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
  ): Promise<OrderActionResultDto> {
    const result = await sendRpc<OrderActionResultDto>(
      this.checkout,
      { cmd: LEAD_ORDER_RPC.CANCEL },
      {
        orderId: id,
        reason: dto.reason,
        actor: { type: LeadOrderActorType.USER, id: user.sub, role: user.role },
      },
    );
    void sendRpc(
      this.identity,
      { cmd: 'identity.audit.log' },
      {
        actorId: user.sub,
        action: 'order.cancel',
        entityType: 'SalesOrder',
        entityId: id,
        meta: { reason: dto.reason, ip: ip || null },
      },
    ).catch(() => undefined);
    return {
      id: result.id,
      status: result.status,
      idempotent: result.idempotent,
    };
  }
}
