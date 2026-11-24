import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  ApiBadGatewayResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  CALL_RPC,
  CallListQueryDto,
  CallPageDto,
  CurrentUser,
  LeadCallDto,
  RmqClient,
  Role,
  Roles,
  sendRpc,
} from '@app/common';
import { ParseLeadIdPipe } from './lead-id.pipe';

/**
 * BE-15 (OPR-6, TEL-2–4): operator qo‘ng‘iroqlari. Mijoz raqami javoblarda yo‘q — provayder lid bo‘yicha oladi (T6).
 * Rollar — operator ish joyidagi bilan bir xil.
 */
@ApiTags('operator')
@ApiBearerAuth()
@Roles(Role.OPERATOR_LEAD, Role.SUPERVISOR, Role.SUPERADMIN)
@Controller('operator')
export class OperatorCallsController {
  constructor(@Inject(RmqClient.LEAD) private readonly lead: ClientProxy) {}

  @Post('leads/:id/call')
  @ApiOperation({
    summary: 'Qo‘ng‘iroq: avval operator telefoni, keyin mijoz',
    description:
      'Lid shu operatorning bronida bo‘lishi kerak. Provayder 3 soniyada javob bermasa ham 201 — bosqich `GET /operator/calls/{id}` da (TEL-2).',
  })
  @ApiCreatedResponse({ type: LeadCallDto })
  @ApiNotFoundResponse({ description: 'Lid topilmadi yoki bu operatorda emas' })
  @ApiConflictResponse({
    description:
      'OPERATOR_PHONE_MISSING — telefon biriktirilmagan; CALL_ACTIVE — operatorda yoki shu lidda tugamagan qo‘ng‘iroq bor; CALL_REQUEST_EXPIRED — so‘rov eskirdi',
  })
  @ApiBadGatewayResponse({
    description: 'TELEPHONY_FAILED — provayder qo‘ng‘iroqni boshlamadi',
  })
  @ApiServiceUnavailableResponse({
    description: 'TELEPHONY_NOT_CONFIGURED — telefoniya ulanmagan',
  })
  start(
    @CurrentUser('sub') operatorId: string,
    @Param('id', ParseLeadIdPipe) leadId: string,
  ): Promise<LeadCallDto> {
    return sendRpc(
      this.lead,
      { cmd: CALL_RPC.START },
      { operatorId, leadId, requestedAt: new Date().toISOString() },
    );
  }

  @Get('calls')
  @ApiOperation({ summary: 'Mening qo‘ng‘iroqlarim (yangisi birinchi)' })
  @ApiOkResponse({ type: CallPageDto })
  mine(
    @CurrentUser('sub') operatorId: string,
    @Query() query: CallListQueryDto,
  ): Promise<CallPageDto> {
    return sendRpc(
      this.lead,
      { cmd: CALL_RPC.LIST },
      { query: { ...query, operatorId } },
    );
  }

  @Get('calls/:id')
  @ApiOperation({
    summary: 'Qo‘ng‘iroq holati va taklif qilingan natija',
    description:
      'Faqat o‘z qo‘ng‘irog‘i. `suggestedOutcome` — javob bermadi, band, o‘chiq server holatidan (TEL-4).',
  })
  @ApiOkResponse({ type: LeadCallDto })
  @ApiNotFoundResponse({ description: 'Qo‘ng‘iroq topilmadi' })
  get(
    @CurrentUser('sub') operatorId: string,
    @Param('id', ParseLeadIdPipe) callId: string,
  ): Promise<LeadCallDto> {
    return sendRpc(this.lead, { cmd: CALL_RPC.GET }, { operatorId, callId });
  }

  @Post('calls/:id/hangup')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Qo‘ng‘iroqni tugatish' })
  @ApiOkResponse({ type: LeadCallDto })
  @ApiNotFoundResponse({ description: 'Qo‘ng‘iroq topilmadi' })
  hangup(
    @CurrentUser('sub') operatorId: string,
    @Param('id', ParseLeadIdPipe) callId: string,
  ): Promise<LeadCallDto> {
    return sendRpc(this.lead, { cmd: CALL_RPC.HANGUP }, { operatorId, callId });
  }
}
