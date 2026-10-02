import { Controller, UseFilters } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  BroadcastPreviewDto,
  BroadcastSendDto,
  BroadcastsQueryDto,
  RpcHttpExceptionFilter,
  UpdateNotificationTemplateDto,
} from '@app/common';
import { BroadcastService } from './broadcast.service';
import { NotificationTemplateService } from './notification-template.service';

/** C6.8 — admin: shablonlar va ommaviy xabar (rol tekshiruvi gateway'da). */
@Controller()
@UseFilters(RpcHttpExceptionFilter)
export class NotificationAdminController {
  constructor(
    private readonly templates: NotificationTemplateService,
    private readonly broadcasts: BroadcastService,
  ) {}

  @MessagePattern({ cmd: 'notification.admin.templates.list' })
  listTemplates() {
    return this.templates.list();
  }

  @MessagePattern({ cmd: 'notification.admin.templates.update' })
  updateTemplate(
    @Payload()
    data: {
      key: string;
      dto: UpdateNotificationTemplateDto;
      actorId?: string;
    },
  ) {
    return this.templates.update(String(data.key), data.dto, data.actorId);
  }

  @MessagePattern({ cmd: 'notification.admin.templates.reset' })
  resetTemplate(@Payload() data: { key: string }) {
    return this.templates.reset(String(data.key));
  }

  @MessagePattern({ cmd: 'notification.admin.broadcast.preview' })
  preview(@Payload() data: { dto: BroadcastPreviewDto }) {
    return this.broadcasts.preview(data.dto);
  }

  @MessagePattern({ cmd: 'notification.admin.broadcast.send' })
  send(@Payload() data: { dto: BroadcastSendDto; actorId?: string }) {
    return this.broadcasts.send(data.dto, data.actorId);
  }

  @MessagePattern({ cmd: 'notification.admin.broadcasts.list' })
  list(@Payload() data: { query?: BroadcastsQueryDto }) {
    return this.broadcasts.list(data?.query ?? {});
  }
}
