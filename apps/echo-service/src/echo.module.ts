import { Module } from '@nestjs/common';
import { CommonConfigModule } from '@app/common';
import { EchoController } from './echo.controller';

@Module({
  imports: [CommonConfigModule],
  controllers: [EchoController],
})
export class EchoModule {}
