import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  AdminLeadsPageDto,
  AdminLeadsQueryDto,
  LeadCardDto,
  RmqClient,
  Role,
  Roles,
  sendRpc,
} from '@app/common';
import { ParseLeadIdPipe } from './lead-id.pipe';

/**
 * Admin va nazoratchi uchun lidlar ro‘yxati (BE-25 shartnomasi, real kod BE-42).
 * Fayl Claude backend oqimining `leads/` papkasida; yo‘l `admin/leads`.
 * Rollar: ADMIN, SUPERADMIN; SUPERVISOR roli BE-05 da qo‘shilgach shu ro‘yxatga kiradi.
 */
@ApiTags('admin-leads')
@ApiBearerAuth()
@Roles(Role.ADMIN, Role.SUPERADMIN)
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
}
