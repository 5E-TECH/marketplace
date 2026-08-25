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
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  CreateSupportTicketDto,
  CurrentUser,
  JwtUser,
  RmqClient,
  sendRpc,
  SupportMessageDto,
  SupportTicketsQueryDto,
} from '@app/common';

@ApiTags('support')
@ApiBearerAuth()
@Controller('support/tickets')
export class SupportController {
  constructor(
    @Inject(RmqClient.IDENTITY) private readonly identity: ClientProxy,
  ) {}
  @Post() create(
    @CurrentUser() u: JwtUser,
    @Body() dto: CreateSupportTicketDto,
  ) {
    return sendRpc(
      this.identity,
      { cmd: 'support.ticket.create' },
      { userId: u.sub, dto },
    );
  }
  @Get() list(
    @CurrentUser() u: JwtUser,
    @Query() query: SupportTicketsQueryDto,
  ) {
    return sendRpc(
      this.identity,
      { cmd: 'support.ticket.list' },
      { userId: u.sub, query },
    );
  }
  @Get(':id') get(@CurrentUser() u: JwtUser, @Param('id') id: string) {
    return sendRpc(
      this.identity,
      { cmd: 'support.ticket.get' },
      { userId: u.sub, id },
    );
  }
  @Post(':id/messages') message(
    @CurrentUser() u: JwtUser,
    @Param('id') id: string,
    @Body() dto: SupportMessageDto,
  ) {
    return sendRpc(
      this.identity,
      { cmd: 'support.ticket.message' },
      { userId: u.sub, id, message: dto.message },
    );
  }
}
