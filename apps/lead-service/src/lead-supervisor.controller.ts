import { Controller, UseFilters } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  CreateFraudIncidentDto,
  FraudActionQueryDto,
  FraudDecisionDto,
  FraudIncidentQueryDto,
  RpcHttpExceptionFilter,
  TransferLeadDto,
} from '@app/common';
import { FraudService } from './fraud.service';
import { LeadAdminService } from './lead-admin.service';
import { LeadSupervisorService } from './lead-supervisor.service';

/** BE-35 RPC lari: nazoratchi (qizil ro‘yxat, o‘tkazish), admin qayta ochishi, firibgarlik markazi. Kim — gateway tokenidan. */
@Controller()
@UseFilters(RpcHttpExceptionFilter)
export class LeadSupervisorController {
  constructor(
    private readonly supervisor: LeadSupervisorService,
    private readonly admin: LeadAdminService,
    private readonly fraud: FraudService,
  ) {}

  @MessagePattern({ cmd: 'lead.supervisor.red-list' })
  redList() {
    return this.supervisor.redList();
  }

  @MessagePattern({ cmd: 'lead.supervisor.transfer' })
  transfer(
    @Payload()
    input: {
      actorId: string;
      leadId: string;
      transfer: TransferLeadDto;
    },
  ) {
    return this.supervisor.transfer(
      input.actorId,
      input.leadId,
      input.transfer,
    );
  }

  @MessagePattern({ cmd: 'lead.supervisor.transfers' })
  transfers(@Payload() input: { date?: string }) {
    return this.supervisor.transfers(input?.date);
  }

  @MessagePattern({ cmd: 'lead.admin.reopen' })
  reopen(
    @Payload() input: { actorId: string; leadId: string; reason: string },
  ) {
    return this.admin.reopen(input.actorId, input.leadId, input.reason);
  }

  @MessagePattern({ cmd: 'lead.fraud.list' })
  list(@Payload() input: { query: FraudIncidentQueryDto }) {
    return this.fraud.list(input?.query ?? {});
  }

  @MessagePattern({ cmd: 'lead.fraud.get' })
  get(@Payload() input: { id: string }) {
    return this.fraud.get(input.id);
  }

  @MessagePattern({ cmd: 'lead.fraud.create' })
  create(
    @Payload() input: { actorId: string; incident: CreateFraudIncidentDto },
  ) {
    return this.fraud.create(input.actorId, input.incident);
  }

  @MessagePattern({ cmd: 'lead.fraud.decide' })
  decide(
    @Payload()
    input: {
      actorId: string;
      id: string;
      decision: FraudDecisionDto;
    },
  ) {
    return this.fraud.decide(input.actorId, input.id, input.decision);
  }

  @MessagePattern({ cmd: 'lead.fraud.actions' })
  actions(@Payload() input: { query: FraudActionQueryDto }) {
    return this.fraud.actions(input?.query ?? {});
  }
}
