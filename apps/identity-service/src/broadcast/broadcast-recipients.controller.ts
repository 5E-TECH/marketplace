import { Controller, UseFilters } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { BroadcastAudience, RpcHttpExceptionFilter } from '@app/common';
import { BroadcastRecipientsService } from './broadcast-recipients.service';

@Controller()
@UseFilters(RpcHttpExceptionFilter)
export class BroadcastRecipientsController {
  constructor(private readonly recipients: BroadcastRecipientsService) {}

  @MessagePattern({ cmd: 'identity.broadcast.count' })
  count(@Payload() data: { audience: BroadcastAudience }) {
    return this.recipients.count(data.audience);
  }

  @MessagePattern({ cmd: 'identity.broadcast.recipients' })
  page(
    @Payload()
    data: {
      audience: BroadcastAudience;
      afterId?: string | null;
      limit?: number;
    },
  ) {
    return this.recipients.page(data);
  }
}
