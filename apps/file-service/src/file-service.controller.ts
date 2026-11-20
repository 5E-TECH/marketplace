import { Controller, UseFilters } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  CREATIVE_RPC,
  CreativeType,
  RpcHttpExceptionFilter,
  UploadFileCommand,
} from '@app/common';
import { CreativeFileService } from './creative-file.service';
import { FileServiceService } from './file-service.service';

@Controller()
@UseFilters(RpcHttpExceptionFilter)
export class FileServiceController {
  constructor(
    private readonly files: FileServiceService,
    private readonly creatives: CreativeFileService,
  ) {}

  @MessagePattern({ cmd: 'file.upload' })
  upload(@Payload() command: UploadFileCommand) {
    return this.files.uploadFile(command);
  }

  /** BE-08: kreativ yuklash uchun imzolangan POST policy. */
  @MessagePattern({ cmd: CREATIVE_RPC.UPLOAD_POLICY })
  creativeUploadPolicy(
    @Payload()
    data: {
      productId: string;
      type: CreativeType;
      contentType: string;
      size: number;
    },
  ) {
    return this.creatives.uploadPolicy(data);
  }

  /** BE-08: yuklangan kreativ faylini tekshirish. */
  @MessagePattern({ cmd: CREATIVE_RPC.VERIFY })
  creativeVerify(@Payload() data: { productId: string; objectKey: string }) {
    return this.creatives.verify(data);
  }

  @MessagePattern({ cmd: CREATIVE_RPC.REMOVE })
  creativeRemove(@Payload() data: { objectKey: string }) {
    return this.creatives.remove(data);
  }
}
