import { Controller, UseFilters } from '@nestjs/common';
import { MessagePattern } from '@nestjs/microservices';
import { DataSource } from 'typeorm';
import { LeadQueueStats, OPS_RPC, RpcHttpExceptionFilter } from '@app/common';

/**
 * BE-26 (T8 «Kuzatuv»: lid navbati o‘sishi): navbatda kutayotgan yangi lidlar va eng eskisining kutish vaqti.
 * Shart operator navbati bilan bir xil (`LeadQueueService` 7-qoida: yangi lid, vaqti kelgan).
 */
@Controller()
@UseFilters(RpcHttpExceptionFilter)
export class LeadOpsController {
  constructor(private readonly dataSource: DataSource) {}

  @MessagePattern({ cmd: OPS_RPC.LEAD_QUEUE })
  async queue(): Promise<LeadQueueStats> {
    const [row] = (await this.dataSource.query(
      `SELECT count(*)::int AS waiting,
              floor(extract(epoch FROM now() - min(created_at)) / 60)::int AS "oldestMinutes"
         FROM lead.lead
        WHERE status = 'NEW' AND is_deleted = FALSE
          AND (next_attempt_at IS NULL OR next_attempt_at <= now())`,
    )) as Array<{ waiting: number; oldestMinutes: number | null }>;
    return {
      waiting: row?.waiting ?? 0,
      oldestMinutes: row?.oldestMinutes ?? null,
    };
  }
}
