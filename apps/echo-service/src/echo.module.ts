import { Module } from '@nestjs/common';
import { CommonConfigModule, ServiceHealthModule } from '@app/common';
import { EchoController } from './echo.controller';

@Module({
  imports: [CommonConfigModule, ServiceHealthModule.register('echo-service')],
  controllers: [EchoController],
})
export class EchoModule {}
