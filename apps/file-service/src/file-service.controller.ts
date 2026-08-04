import { Controller, UseFilters } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { RpcHttpExceptionFilter, UploadFileCommand } from '@app/common';
import { FileServiceService } from './file-service.service';

@Controller()
@UseFilters(RpcHttpExceptionFilter)
export class FileServiceController {
  constructor(private readonly files: FileServiceService) {}

  @MessagePattern({ cmd: 'file.upload' })
  upload(@Payload() command: UploadFileCommand) {
    return this.files.uploadFile(command);
  }
}
