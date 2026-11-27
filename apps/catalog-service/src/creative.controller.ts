import { Controller, UseFilters } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  CREATIVE_RPC,
  RpcHttpExceptionFilter,
  VerifiedCreativeFile,
} from '@app/common';
import { CreativeService } from './creative.service';

/** Kreativlar (BE-08): gateway admin yo‘llari uchun. */
@Controller()
@UseFilters(RpcHttpExceptionFilter)
export class CreativeController {
  constructor(private readonly creatives: CreativeService) {}

  @MessagePattern({ cmd: CREATIVE_RPC.CREATE })
  create(
    @Payload()
    data: {
      productId: string;
      file: VerifiedCreativeFile;
      actorId: string | null;
    },
  ) {
    return this.creatives.create(data);
  }

  @MessagePattern({ cmd: CREATIVE_RPC.FIND })
  find(@Payload() data: { productId: string; objectKey: string }) {
    return this.creatives.find(data);
  }

  @MessagePattern({ cmd: CREATIVE_RPC.LIST })
  list(@Payload() data: { productId: string }) {
    return this.creatives.list(data?.productId);
  }

  @MessagePattern({ cmd: CREATIVE_RPC.FILES })
  files(@Payload() data: { productId: string }) {
    return this.creatives.files(data?.productId);
  }

  @MessagePattern({ cmd: CREATIVE_RPC.DELETE })
  delete(@Payload() data: { productId: string; creativeId: string }) {
    return this.creatives.delete(data);
  }
}
