import { Controller, UseFilters } from '@nestjs/common';
import { EventPattern, MessagePattern, Payload } from '@nestjs/microservices';
import {
  CALL_EVENTS,
  CALL_RPC,
  CallCompletedEvent,
  CallListQueryDto,
  CallStatusEvent,
  RecordingMode,
  RecordingReadyEvent,
  Role,
  RpcHttpExceptionFilter,
  SetOperatorPhoneDto,
} from '@app/common';
import { CallService } from './call.service';

/** BE-15 RPC lari va provayder hodisalari. Kim — gateway tokenidan. */
@Controller()
@UseFilters(RpcHttpExceptionFilter)
export class CallController {
  constructor(private readonly calls: CallService) {}

  @MessagePattern({ cmd: CALL_RPC.START })
  start(@Payload() input: { operatorId: string; leadId: string }) {
    return this.calls.start(input.operatorId, input.leadId);
  }

  @MessagePattern({ cmd: CALL_RPC.GET })
  get(@Payload() input: { operatorId: string; callId: string }) {
    return this.calls.get(input.operatorId, input.callId);
  }

  @MessagePattern({ cmd: CALL_RPC.HANGUP })
  hangup(@Payload() input: { operatorId: string; callId: string }) {
    return this.calls.hangup(input.operatorId, input.callId);
  }

  @MessagePattern({ cmd: CALL_RPC.LIST })
  list(@Payload() input: { query: CallListQueryDto }) {
    return this.calls.list(input?.query ?? {});
  }

  @MessagePattern({ cmd: CALL_RPC.RECORDING_ACCESS })
  recordingAccess(
    @Payload()
    input: {
      callId: string;
      userId: string;
      role: Role;
      mode: RecordingMode;
    },
  ) {
    return this.calls.recordingAccess(input);
  }

  @MessagePattern({ cmd: CALL_RPC.RECORDING_REF })
  recordingRef(@Payload() input: { callId: string }) {
    return this.calls.recordingRef(input.callId);
  }

  @MessagePattern({ cmd: CALL_RPC.PHONE_GET })
  phone(@Payload() input: { operatorId: string }) {
    return this.calls.phone(input.operatorId);
  }

  @MessagePattern({ cmd: CALL_RPC.PHONE_SET })
  setPhone(
    @Payload()
    input: {
      operatorId: string;
      dto: SetOperatorPhoneDto;
      actorId: string;
    },
  ) {
    return this.calls.setPhone(input.operatorId, input.dto, input.actorId);
  }

  @MessagePattern({ cmd: CALL_RPC.PHONE_DELETE })
  deletePhone(@Payload() input: { operatorId: string }) {
    return this.calls.deletePhone(input.operatorId);
  }

  @EventPattern(CALL_EVENTS.STATUS)
  onStatus(@Payload() event: CallStatusEvent) {
    return this.calls.onStatus(event);
  }

  @EventPattern(CALL_EVENTS.COMPLETED)
  onCompleted(@Payload() event: CallCompletedEvent) {
    return this.calls.onCompleted(event);
  }

  @EventPattern(CALL_EVENTS.RECORDING_READY)
  onRecordingReady(@Payload() event: RecordingReadyEvent) {
    return this.calls.onRecordingReady(event);
  }
}
