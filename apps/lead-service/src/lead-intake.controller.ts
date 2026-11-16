import { Controller, UseFilters } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { CreateLeadDto, RpcHttpExceptionFilter } from '@app/common';
import { LeadIntakeService } from './lead-intake.service';

/** POST /leads RPC (BE-12). */
@Controller()
@UseFilters(RpcHttpExceptionFilter)
export class LeadIntakeController {
  constructor(private readonly intake: LeadIntakeService) {}

  @MessagePattern({ cmd: 'lead.create' })
  create(
    @Payload()
    input: {
      lead: CreateLeadDto;
      ip: string | null;
      userAgent: string | null;
    },
  ) {
    return this.intake.create(input);
  }
}
