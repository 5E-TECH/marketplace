import { Module } from '@nestjs/common';
import { CommonConfigModule, ServiceHealthModule } from '@app/common';
import { FileServiceController } from './file-service.controller';
import { FileServiceService } from './file-service.service';
import { CreativeFileService } from './creative-file.service';

@Module({
  imports: [CommonConfigModule, ServiceHealthModule.register('file-service')],
  controllers: [FileServiceController],
  providers: [FileServiceService, CreativeFileService],
})
export class FileServiceModule {}
