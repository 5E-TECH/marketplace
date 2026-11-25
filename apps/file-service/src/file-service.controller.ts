import { Controller, UseFilters } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  AFFILIATE_DOCUMENT_RPC,
  CREATIVE_RPC,
  CreativeType,
  RpcHttpExceptionFilter,
  UploadFileCommand,
  WHOLESALER_CABINET_RPC,
} from '@app/common';
import { CreativeFileService } from './creative-file.service';
import { PrivateFileService } from './private-file.service';
import { FileServiceService } from './file-service.service';

@Controller()
@UseFilters(RpcHttpExceptionFilter)
export class FileServiceController {
  constructor(
    private readonly files: FileServiceService,
    private readonly creatives: CreativeFileService,
    private readonly privateFiles: PrivateFileService,
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

  /** BE-30: optovikning yopiq hujjatlari (KYC, sertifikat). */
  @MessagePattern({ cmd: WHOLESALER_CABINET_RPC.PRIVATE_UPLOAD_POLICY })
  privateUploadPolicy(
    @Payload()
    data: {
      wholesalerId: string;
      contentType: string;
      size: number;
    },
  ) {
    return this.privateFiles.uploadPolicy(data);
  }

  @MessagePattern({ cmd: WHOLESALER_CABINET_RPC.PRIVATE_VERIFY })
  privateVerify(@Payload() data: { wholesalerId: string; objectKey: string }) {
    return this.privateFiles.verify(data);
  }

  @MessagePattern({ cmd: WHOLESALER_CABINET_RPC.PRIVATE_GET })
  privateGet(@Payload() data: { objectKey: string }) {
    return this.privateFiles.get(data);
  }

  /** BE-25 5-tur: sotuvchining maqom ma’lumotnomasi (yopiq). */
  @MessagePattern({ cmd: AFFILIATE_DOCUMENT_RPC.STORE })
  storeAffiliateDocument(
    @Payload()
    data: {
      affiliateId: string;
      fileName: string;
      base64: string;
    },
  ) {
    return this.privateFiles.storeAffiliateDocument(data);
  }

  @MessagePattern({ cmd: AFFILIATE_DOCUMENT_RPC.COMMIT })
  commitAffiliateDocument(
    @Payload()
    data: {
      affiliateId: string;
      documentId: string;
      deadline: number;
    },
  ) {
    return this.privateFiles.commitAffiliateDocument(data);
  }

  @MessagePattern({ cmd: AFFILIATE_DOCUMENT_RPC.REMOVE })
  removeAffiliateDocument(
    @Payload() data: { affiliateId: string; objectKey: string },
  ) {
    return this.privateFiles.removeAffiliateDocument(data);
  }
}
