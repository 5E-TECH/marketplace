import { Controller, Get, Inject, Param, Patch, Query } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { ParseLeadIdPipe } from '../leads/lead-id.pipe';
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  CurrentUser,
  JwtUser,
  NotificationDto,
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
  @ApiOkResponse({
    description: 'O‘qilgan qilingan xabarnomalar soni',
    schema: {
      type: 'object',
      properties: { updated: { type: 'integer', example: 3 } },
      example: { updated: 3 },
    },
  })
  markAllRead(@CurrentUser() user: JwtUser) {
    return sendRpc(
      this.notifications,
      { cmd: 'notifications.mark-all-read' },
      { userId: user.sub },
    );
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Bitta xabarnomani o‘qilgan qilish' })
  @ApiOkResponse({ type: NotificationDto })
  @ApiNotFoundResponse({
    description: 'Xabarnoma topilmadi (boshqa foydalanuvchiniki ham)',
  })
  markRead(
    @CurrentUser() user: JwtUser,
    // BE-47: noto‘g‘ri id — 400 (bazaga yetib 500 bermasin)
    @Param('id', ParseLeadIdPipe) id: string,
  ) {
    return sendRpc(
      this.notifications,
      { cmd: 'notifications.mark-read' },
      { userId: user.sub, id },
    );
  }
}
