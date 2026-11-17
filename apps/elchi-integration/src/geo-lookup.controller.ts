import { Controller, UseFilters } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { RpcHttpExceptionFilter } from '@app/common';
import { GeoLookupService } from './geo-lookup.service';

/** Lid manzili uchun geo RPC lari (BE-38). Chaqiruvchilar: api-gateway (`/regions/tree`), lead-service. */
@Controller()
@UseFilters(RpcHttpExceptionFilter)
export class GeoLookupController {
  constructor(private readonly geo: GeoLookupService) {}

  @MessagePattern({ cmd: 'integration.geo.region-tree' })
  regionTree() {
    return this.geo.regionTree();
  }

  @MessagePattern({ cmd: 'integration.geo.resolve-address' })
  resolveAddress(
    @Payload() input: { regionSoato: string; districtSoato: string },
  ) {
    return this.geo.resolveAddress(input);
  }
}
