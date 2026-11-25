import { Controller, UseFilters } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  AdminLeadFilterDto,
  AdminLeadsQueryDto,
  AdminLeadViewer,
  LeadExportChunkInput,
  LeadReviewDecisionDto,
  RpcHttpExceptionFilter,
} from '@app/common';
import { LeadAdminService } from './lead-admin.service';

/** Admin va nazoratchi lidlar RPC lari (BE-42; FE-26 — BE-25). Ko‘ruvchi roli — gateway tokenidan. */
@Controller()
@UseFilters(RpcHttpExceptionFilter)
export class LeadAdminController {
  constructor(private readonly admin: LeadAdminService) {}

  @MessagePattern({ cmd: 'lead.admin.list' })
  list(
    @Payload() input: { query: AdminLeadsQueryDto; viewer?: AdminLeadViewer },
  ) {
    return this.admin.list(input.query ?? {}, viewerOf(input.viewer));
  }

  @MessagePattern({ cmd: 'lead.admin.card' })
  card(@Payload() input: { leadId: string; viewer?: AdminLeadViewer }) {
    return this.admin.card(input.leadId, viewerOf(input.viewer));
  }

  @MessagePattern({ cmd: 'lead.admin.filter-options' })
  filterOptions() {
    return this.admin.filterOptions();
  }

  @MessagePattern({ cmd: 'lead.admin.release' })
  release(
    @Payload() input: { actorId: string; leadId: string; reason: string },
  ) {
    return this.admin.release(input.actorId, input.leadId, input.reason);
  }

  @MessagePattern({ cmd: 'lead.admin.review' })
  review(
    @Payload() input: { actorId: string; decision: LeadReviewDecisionDto },
  ) {
    return this.admin.review(input.actorId, input.decision);
  }

  @MessagePattern({ cmd: 'lead.admin.export-count' })
  exportCount(
    @Payload() input: { filters: AdminLeadFilterDto; until: string },
  ) {
    return this.admin.exportCount(input.filters ?? {}, new Date(input.until));
  }

  @MessagePattern({ cmd: 'lead.admin.export-chunk' })
  exportChunk(@Payload() input: LeadExportChunkInput) {
    return this.admin.exportChunk(input);
  }
}

/** Ko‘ruvchi berilmasa — eng kam huquq (nazoratchi ko‘rinishi). */
const viewerOf = (viewer?: AdminLeadViewer): AdminLeadViewer => ({
  admin: viewer?.admin === true,
});
