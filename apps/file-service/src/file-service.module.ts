import { Module } from '@nestjs/common';
import { CommonConfigModule } from '@app/common';
import { FileServiceController } from './file-service.controller';
import { FileServiceService } from './file-service.service';

@Module({
  imports: [CommonConfigModule],
  controllers: [FileServiceController],
  providers: [FileServiceService],
})
export class FileServiceModule {}
