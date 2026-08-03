import { Controller, UseFilters } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { NotificationsQueryDto, RpcHttpExceptionFilter } from '@app/common';
import { NotificationService } from './notification.service';

@Controller()
@UseFilters(RpcHttpExceptionFilter)
export class NotificationController {
  constructor(private readonly notifications: NotificationService) {}

  @MessagePattern({ cmd: 'notifications.list' })
  list(@Payload() data: { userId: string; query: NotificationsQueryDto }) {
    return this.notifications.findAll(data.userId, data.query);
  }

  @MessagePattern({ cmd: 'notifications.mark-read' })
  markRead(@Payload() data: { userId: string; id: string }) {
    return this.notifications.markRead(data.userId, data.id);
  }

  @MessagePattern({ cmd: 'notifications.mark-all-read' })
  markAllRead(@Payload() data: { userId: string }) {
    return this.notifications.markAllRead(data.userId);
  }
}
