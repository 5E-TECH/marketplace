import { Controller, UseFilters } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  AdminWholesalersQueryDto,
  CATALOG_WHOLESALER_PAYMENT_DETAILS,
  CreateWholesalerDto,
  RpcHttpExceptionFilter,
  UpdateWholesalerDto,
} from '@app/common';
import { WholesalerService } from './wholesaler.service';

/** BE-07: optovik — admin API (gateway `admin/wholesalers`). */
@Controller()
@UseFilters(RpcHttpExceptionFilter)
export class WholesalerController {
  constructor(private readonly wholesalers: WholesalerService) {}

  @MessagePattern({ cmd: 'catalog.wholesaler.admin-create' })
  create(@Payload() dto: CreateWholesalerDto) {
    return this.wholesalers.create(dto);
  }

  @MessagePattern({ cmd: 'catalog.wholesaler.admin-list' })
  list(@Payload() query: AdminWholesalersQueryDto) {
    return this.wholesalers.list(query ?? {});
  }

  @MessagePattern({ cmd: 'catalog.wholesaler.admin-get' })
  get(@Payload() data: { id: string }) {
    return this.wholesalers.get(String(data.id));
  }

  /** BE-33: finance bank fayli uchun (ichki). */
  @MessagePattern({ cmd: CATALOG_WHOLESALER_PAYMENT_DETAILS })
  paymentDetails(@Payload() data: { ids: string[] }) {
    return this.wholesalers.paymentDetails(data?.ids ?? []);
  }

  @MessagePattern({ cmd: 'catalog.wholesaler.admin-update' })
  update(@Payload() data: { id: string; dto: UpdateWholesalerDto }) {
    return this.wholesalers.update(String(data.id), data.dto);
  }
}
