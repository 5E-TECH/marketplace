import { Controller, Get, Inject, Param, Patch, Query } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  CurrentUser,
  JwtUser,
  NotificationsPageDto,
  NotificationsQueryDto,
  RmqClient,
  sendRpc,
} from '@app/common';

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(
    @Inject(RmqClient.NOTIFICATION)
    private readonly notifications: ClientProxy,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Joriy foydalanuvchi xabarnomalari' })
  @ApiOkResponse({ type: NotificationsPageDto })
  list(@CurrentUser() user: JwtUser, @Query() query: NotificationsQueryDto) {
    return sendRpc(
      this.notifications,
      { cmd: 'notifications.list' },
      { userId: user.sub, query },
    );
  }

  @Patch('read-all')
  @ApiOperation({ summary: 'Barcha xabarnomalarni o‘qilgan qilish' })
  markAllRead(@CurrentUser() user: JwtUser) {
    return sendRpc(
      this.notifications,
      { cmd: 'notifications.mark-all-read' },
      { userId: user.sub },
    );
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Bitta xabarnomani o‘qilgan qilish' })
  markRead(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return sendRpc(
      this.notifications,
      { cmd: 'notifications.mark-read' },
      { userId: user.sub, id },
    );
  }
}
