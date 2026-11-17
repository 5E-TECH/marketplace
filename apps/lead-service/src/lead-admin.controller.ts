import { Controller, UseFilters } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { AdminLeadsQueryDto, RpcHttpExceptionFilter } from '@app/common';
import { LeadAdminService } from './lead-admin.service';

/** Admin va nazoratchi lidlar RPC lari (BE-42). */
@Controller()
@UseFilters(RpcHttpExceptionFilter)
export class LeadAdminController {
  constructor(private readonly admin: LeadAdminService) {}

  @MessagePattern({ cmd: 'lead.admin.list' })
  list(@Payload() input: { query: AdminLeadsQueryDto }) {
    return this.admin.list(input.query ?? {});
  }

  @MessagePattern({ cmd: 'lead.admin.card' })
  card(@Payload() input: { leadId: string }) {
    return this.admin.card(input.leadId);
  }
}
