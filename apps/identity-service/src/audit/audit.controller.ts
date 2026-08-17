import { Controller, UseFilters } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { ActivityLogService, RpcHttpExceptionFilter } from '@app/common';

/**
 * C1.31 — Admin audit sink. Gateway har admin write amalidan so'ng shu yerga
 * yozadi (actor+ip gatewayда ma'lum). Faqat qo'shiladi (immutable) — tahrir/
 * o'chirish patterni YO'Q.
 */
@Controller()
@UseFilters(RpcHttpExceptionFilter)
export class AuditController {
  constructor(private readonly activityLog: ActivityLogService) {}

  @MessagePattern({ cmd: 'identity.audit.log' })
  log(
    @Payload()
    data: {
      actorId?: string | null;
      action: string;
      entityType?: string | null;
      entityId?: string | null;
      meta?: unknown;
    },
  ) {
    return this.activityLog.log({
      actorId: data?.actorId ?? null,
      action: String(data?.action ?? 'unknown'),
      entityType: data?.entityType ?? null,
      entityId: data?.entityId ?? null,
      meta: data?.meta ?? null,
    });
  }
}
