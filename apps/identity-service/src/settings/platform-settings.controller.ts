import { Controller, UseFilters } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { RpcHttpExceptionFilter, UpdateAdminSettingsDto } from '@app/common';
import { PlatformSettingsService } from './platform-settings.service';

@Controller()
@UseFilters(RpcHttpExceptionFilter)
export class PlatformSettingsController {
  constructor(private readonly settings: PlatformSettingsService) {}

  @MessagePattern({ cmd: 'identity.settings.get' })
  get() {
    return this.settings.get();
  }

  @MessagePattern({ cmd: 'identity.settings.update' })
  update(
    @Payload()
    data: {
      actorId: string;
      dto: UpdateAdminSettingsDto;
      ip?: string;
    },
  ) {
    return this.settings.update(String(data.actorId), data.dto, data.ip);
  }
}
