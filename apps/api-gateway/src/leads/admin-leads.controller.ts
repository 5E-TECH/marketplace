import { Controller, Get, Param, Query } from '@nestjs/common';
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
} from '@app/common';
import { ParseLeadIdPipe } from './lead-id.pipe';
import { notImplementedYet } from './lead-stub';

/**
 * Admin va nazoratchi uchun lidlar ro‘yxati (BE-25 shartnomasi, real kod BE-42).
 * Fayl Claude backend oqimining `leads/` papkasida; yo‘l `admin/leads`.
 * Rol cheklovi `@Roles(Role.ADMIN, Role.SUPERADMIN, Role.SUPERVISOR)` BE-05 dan keyin.
 */
@ApiTags('admin-leads')
@ApiBearerAuth()
@Controller('admin/leads')
export class AdminLeadsController {
  @Get()
  @ApiOperation({
    summary: 'Lidlar ro‘yxati: holat, sotuvchi, mahsulot, operator, sana',
    description: 'Telefon niqoblangan (BE-42).',
  })
  @ApiOkResponse({ type: AdminLeadsPageDto })
  list(@Query() _query: AdminLeadsQueryDto): Promise<AdminLeadsPageDto> {
    return notImplementedYet('BE-42');
  }

  @Get(':id')
  @ApiOperation({ summary: 'Lid kartasi (admin va nazoratchi)' })
  @ApiOkResponse({ type: LeadCardDto })
  @ApiNotFoundResponse({ description: 'Lid topilmadi' })
  getCard(@Param('id', ParseLeadIdPipe) _id: string): Promise<LeadCardDto> {
    return notImplementedYet('BE-42');
  }
}
