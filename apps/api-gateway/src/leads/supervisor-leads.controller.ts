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
  CurrentUser,
  LeadTransferDto,
  LeadTransfersQueryDto,
  RedListDto,
  RmqClient,
  Role,
  Roles,
  sendRpc,
  TransferLeadDto,
} from '@app/common';
import { ParseLeadIdPipe } from './lead-id.pipe';

/**
 * Nazoratchi paneli (OPR-8; BE-35): qizil ro‘yxat va lidni boshqa operatorga o‘tkazish.
 * TZ 3: «Lidni boshqa operatorga o‘tkazish» — nazoratchi va admin (superadmin — hamma amal).
 */
@ApiTags('supervisor')
@ApiBearerAuth()
@Roles(Role.SUPERVISOR, Role.ADMIN, Role.SUPERADMIN)
@Controller('supervisor')
export class SupervisorLeadsController {
  constructor(@Inject(RmqClient.LEAD) private readonly lead: ClientProxy) {}

  @Get('red-list')
  @ApiOperation({
    summary:
      'Qizil ro‘yxat: 10 daqiqadan ortiq kutgan yangi lidlar va vaqti o‘tgan rejalashtirilgan qo‘ng‘iroqlar',
    description:
      'So‘rov paytida hisoblanadi; ekran har daqiqada so‘raydi (OPR-8). Eng uzoq kutayotgani tepada.',
  })
  @ApiOkResponse({ type: RedListDto })
  redList(): Promise<RedListDto> {
    return sendRpc(this.lead, { cmd: 'lead.supervisor.red-list' }, {});
  }

  @Post('leads/:id/transfer')
  @ApiOperation({
    summary: 'Lidni boshqa operatorga o‘tkazish',
    description:
      'Faqat «Ishda» holatidagi operatorga; lid uning bronlariga tushadi (10 daqiqa, 5 ta chegara). Lid tarixiga kim, qachon, kimdan kimga yoziladi.',
  })
  @ApiOkResponse({ type: LeadTransferDto })
  @ApiNotFoundResponse({ description: 'Lid topilmadi' })
  @ApiConflictResponse({
    description:
      'OPERATOR_ON_BREAK, OPERATOR_OFFLINE, BOOKING_LIMIT_REACHED, LEAD_NOT_TRANSFERABLE',
  })
  transfer(
    @CurrentUser('sub') actorId: string,
    @Param('id', ParseLeadIdPipe) leadId: string,
    @Body() transfer: TransferLeadDto,
  ): Promise<LeadTransferDto> {
    return sendRpc(
      this.lead,
      { cmd: 'lead.supervisor.transfer' },
      { actorId, leadId, transfer },
    );
  }

  @Get('transfers')
  @ApiOperation({
    summary: 'Bir kunda boshqa operatorga o‘tkazilgan lidlar (sukut — bugun)',
  })
  @ApiOkResponse({ type: [LeadTransferDto] })
  transfers(@Query() query: LeadTransfersQueryDto): Promise<LeadTransferDto[]> {
    return sendRpc(
      this.lead,
      { cmd: 'lead.supervisor.transfers' },
      { date: query.date },
    );
  }
}
