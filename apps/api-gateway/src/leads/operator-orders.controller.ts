import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Ip,
  Param,
  Post,
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
  OrderActionResultDto,
  RmqClient,
  Role,
  Roles,
  sendRpc,
} from '@app/common';
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
