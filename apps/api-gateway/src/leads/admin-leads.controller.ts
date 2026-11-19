import {
  Body,
  Controller,
  Get,
  Inject,
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
  AdminLeadsPageDto,
  AdminLeadsQueryDto,
  CurrentUser,
  LeadCardDto,
  LeadReopenedDto,
  ReopenLeadDto,
  RmqClient,
  Role,
  Roles,
  sendRpc,
} from '@app/common';
import { ParseLeadIdPipe } from './lead-id.pipe';

/**
 * Admin va nazoratchi uchun lidlar ro‘yxati (BE-25 shartnomasi, real kod BE-42).
 * Fayl Claude backend oqimining `leads/` papkasida; yo‘l `admin/leads`.
 * Rollar: ro‘yxat va karta — ADMIN, SUPERVISOR, SUPERADMIN; «Rad etildi» lidni qayta ochish — faqat admin
 * (TZ 3-bo‘lim jadvali).
 */
@ApiTags('admin-leads')
@ApiBearerAuth()
@Roles(Role.ADMIN, Role.SUPERVISOR, Role.SUPERADMIN)
@Controller('admin/leads')
export class AdminLeadsController {
  constructor(@Inject(RmqClient.LEAD) private readonly lead: ClientProxy) {}

  @Get()
  @ApiOperation({
    summary: 'Lidlar ro‘yxati: holat, sotuvchi, mahsulot, operator, sana',
    description: 'Telefon niqoblangan (BE-42).',
  })
  @ApiOkResponse({ type: AdminLeadsPageDto })
  list(@Query() query: AdminLeadsQueryDto): Promise<AdminLeadsPageDto> {
    return sendRpc(this.lead, { cmd: 'lead.admin.list' }, { query });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Lid kartasi (admin va nazoratchi)' })
  @ApiOkResponse({ type: LeadCardDto })
  @ApiNotFoundResponse({ description: 'Lid topilmadi' })
  getCard(@Param('id', ParseLeadIdPipe) leadId: string): Promise<LeadCardDto> {
    return sendRpc(this.lead, { cmd: 'lead.admin.card' }, { leadId });
  }

  @Post(':id/reopen')
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  @ApiOperation({
    summary: '«Rad etildi» lidni qayta ochish (faqat admin, sabab majburiy)',
    description:
      'TZ 3 ruxsatlar jadvali va 5-bo‘lim 10-qoida (BE-35). Lid navbatga qaytadi; tarixga kim, qachon va sabab yoziladi.',
  })
  @ApiOkResponse({ type: LeadReopenedDto })
  @ApiNotFoundResponse({ description: 'Lid topilmadi' })
  @ApiConflictResponse({
    description:
      'LEAD_NOT_REJECTED; ACTIVE_LEAD_EXISTS — shu raqam va mahsulotda faol lid bor',
  })
  reopen(
    @CurrentUser('sub') actorId: string,
    @Param('id', ParseLeadIdPipe) leadId: string,
    @Body() body: ReopenLeadDto,
  ): Promise<LeadReopenedDto> {
    return sendRpc(
      this.lead,
      { cmd: 'lead.admin.reopen' },
      { actorId, leadId, reason: body.reason },
    );
  }
}
