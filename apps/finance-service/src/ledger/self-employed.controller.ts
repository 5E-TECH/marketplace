import { Controller, UseFilters } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  RpcHttpExceptionFilter,
  SELF_EMPLOYED_RPC,
  SelfEmployedDecisionInput,
  SelfEmployedListQueryDto,
  SubmitSelfEmployedInput,
} from '@app/common';
import { SelfEmployedService } from './self-employed.service';

/** BE-25 5-tur: sotuvchining JShShIR arizasi va moliya tekshiruvi. */
@Controller()
@UseFilters(RpcHttpExceptionFilter)
export class SelfEmployedController {
  constructor(private readonly selfEmployed: SelfEmployedService) {}

  @MessagePattern({ cmd: SELF_EMPLOYED_RPC.CURRENT })
  current(@Payload() input: { affiliateId: string }) {
    return this.selfEmployed.current(input);
  }

  @MessagePattern({ cmd: SELF_EMPLOYED_RPC.SUBMIT })
  submit(@Payload() input: SubmitSelfEmployedInput) {
    return this.selfEmployed.submit(input);
  }

  @MessagePattern({ cmd: SELF_EMPLOYED_RPC.RENAME })
  rename(@Payload() input: { affiliateId: string; fullName: string }) {
    return this.selfEmployed.rename(input);
  }

  @MessagePattern({ cmd: SELF_EMPLOYED_RPC.DOCUMENT_MINE })
  documentMine(@Payload() input: { affiliateId: string }) {
    return this.selfEmployed.documentMine(input);
  }

  @MessagePattern({ cmd: SELF_EMPLOYED_RPC.DOCUMENT })
  document(@Payload() input: { id: string }) {
    return this.selfEmployed.document(input);
  }

  @MessagePattern({ cmd: SELF_EMPLOYED_RPC.LIST })
  list(@Payload() input: { query?: SelfEmployedListQueryDto }) {
    return this.selfEmployed.list(input);
  }

  @MessagePattern({ cmd: SELF_EMPLOYED_RPC.GET })
  get(@Payload() input: { id: string }) {
    return this.selfEmployed.get(input);
  }

  @MessagePattern({ cmd: SELF_EMPLOYED_RPC.REVEAL })
  reveal(@Payload() input: { id: string }) {
    return this.selfEmployed.reveal(input);
  }

  @MessagePattern({ cmd: SELF_EMPLOYED_RPC.APPROVE })
  approve(@Payload() input: SelfEmployedDecisionInput) {
    return this.selfEmployed.approve(input);
  }

  @MessagePattern({ cmd: SELF_EMPLOYED_RPC.REJECT })
  reject(@Payload() input: SelfEmployedDecisionInput) {
    return this.selfEmployed.reject(input);
  }

  @MessagePattern({ cmd: SELF_EMPLOYED_RPC.REVOKE })
  revoke(@Payload() input: SelfEmployedDecisionInput) {
    return this.selfEmployed.revoke(input);
  }
}
