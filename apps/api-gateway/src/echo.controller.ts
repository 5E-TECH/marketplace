import { Controller, Get, Inject, Query } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { ApiTags } from '@nestjs/swagger';
import { firstValueFrom } from 'rxjs';
import { Public, RmqClient } from '@app/common';

/**
 * Demo — gateway'dan RMQ orqali echo-service'ga so'rov yuborib, javobni qaytaradi.
 * RMQ transport ishlayotganini tekshiradi (TC4). Keyin real servislar shu shablonda.
 */
@ApiTags('demo')
@Controller('echo')
export class EchoController {
  constructor(@Inject(RmqClient.ECHO) private readonly client: ClientProxy) {}

  @Public()
  @Get()
  async echo(@Query('message') message = 'salom') {
    return firstValueFrom(this.client.send({ cmd: 'echo' }, { message }));
  }
}
