import { Controller, UseFilters } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { RpcHttpExceptionFilter, UpdateLeadAddressDto } from '@app/common';
import { LeadAddressService } from './lead-address.service';

/** Manzil RPC lari (BE-38). Gateway ulanishi: PATCH /operator/leads/:id/address — BE-13 (javob lid kartasi). */
@Controller()
@UseFilters(RpcHttpExceptionFilter)
export class LeadAddressController {
  constructor(private readonly address: LeadAddressService) {}

  @MessagePattern({ cmd: 'lead.address.update' })
  update(
    @Payload()
    input: {
      leadId: string;
      operatorId: string;
      address: UpdateLeadAddressDto;
    },
  ) {
    return this.address.confirmByOperator(
      input.leadId,
      input.operatorId,
      input.address,
    );
  }
}
