import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';

@Controller()
export class EchoController {
  // Gateway { cmd: 'echo' } yuboradi — biz yuborilgan ma'lumotni qaytaramiz.
  @MessagePattern({ cmd: 'echo' })
  echo(@Payload() data: unknown) {
    return { echo: data, at: new Date().toISOString(), from: 'echo-service' };
  }
}
