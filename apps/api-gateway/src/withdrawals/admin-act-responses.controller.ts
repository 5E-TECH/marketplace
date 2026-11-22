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
  ApiBearerAuth,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  CurrentUser,
  FINANCE_SETTLEMENT_RESPONSE_RPC,
  JwtUser,
  RmqClient,
  Role,
  Roles,
  sendRpc,
  SettlementCommentDto,
  SettlementDisputeDto,
  SettlementDisputePageDto,
  SettlementDisputeQueryDto,
  WholesalerActDto,
} from '@app/common';
import { ParseLeadIdPipe } from '../leads/lead-id.pipe';

/**
 * BE-46 (FE-24 TC2 «E’tiroz yuborildi → moliyaga ko‘rindi»): optovik javoblari moliyada.
 * Ko‘rish — FINANCE, ADMIN, SUPERADMIN; javob — FINANCE va SUPERADMIN (TZ 3: moliya). Javob audit jurnaliga yoziladi.
 * Yo‘l `settlements/:id` bilan to‘qnashmasligi uchun alohida (`act-responses`).
 */
@ApiTags('admin-finance')
@ApiBearerAuth()
@Controller('admin/finance/act-responses')
export class AdminActResponsesController {
  constructor(
    @Inject(RmqClient.FINANCE) private readonly finance: ClientProxy,
    @Inject(RmqClient.IDENTITY) private readonly identity: ClientProxy,
  ) {}

  @Get('disputes')
  @Roles(Role.ADMIN, Role.FINANCE, Role.SUPERADMIN)
  @ApiOperation({ summary: 'Optovik e’tirozlari (ochiqlari birinchi)' })
  @ApiOkResponse({ type: SettlementDisputePageDto })
  disputes(
    @Query() query: SettlementDisputeQueryDto,
  ): Promise<SettlementDisputePageDto> {
    return sendRpc(
      this.finance,
      { cmd: FINANCE_SETTLEMENT_RESPONSE_RPC.DISPUTES },
      { query },
    );
  }

  @Get('acts/:id')
  @Roles(Role.ADMIN, Role.FINANCE, Role.SUPERADMIN)
  @ApiOperation({ summary: 'Akt, optovik qabuli va e’tirozlar' })
  @ApiOkResponse({ type: WholesalerActDto })
  @ApiNotFoundResponse({ description: 'Akt topilmadi' })
  act(@Param('id', ParseLeadIdPipe) id: string): Promise<WholesalerActDto> {
    return sendRpc(
      this.finance,
      { cmd: FINANCE_SETTLEMENT_RESPONSE_RPC.ACT },
      { id },
    );
  }

  @Post('disputes/:id/answer')
  @Roles(Role.FINANCE, Role.SUPERADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'E’tirozga javob — optovik aktida ko‘rinadi' })
  @ApiOkResponse({ type: SettlementDisputeDto })
  @ApiNotFoundResponse({ description: 'E’tiroz topilmadi' })
  @ApiConflictResponse({ description: 'Allaqachon javob berilgan' })
  async answer(
    @Param('id', ParseLeadIdPipe) id: string,
    @Body() dto: SettlementCommentDto,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
  ): Promise<SettlementDisputeDto> {
    const dispute = await sendRpc<SettlementDisputeDto>(
      this.finance,
      { cmd: FINANCE_SETTLEMENT_RESPONSE_RPC.ANSWER },
      { id, userId: user.sub, comment: dto.comment },
    );
    void sendRpc(
      this.identity,
      { cmd: 'identity.audit.log' },
      {
        actorId: user.sub,
        action: 'settlement.dispute.answer',
        entityType: 'SettlementDispute',
        entityId: id,
        meta: {
          settlementId: dispute.settlementId,
          answer: dto.comment,
          ip: ip ?? null,
        },
      },
    ).catch(() => undefined);
    return dispute;
  }
}
