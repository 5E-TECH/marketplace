import { Controller, UseFilters } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  ActivityLogQuery,
  ActivityLogService,
  RpcHttpExceptionFilter,
} from '@app/common';
import { User } from '../entities/user.entity';

/**
 * C1.31 — Admin audit sink. Gateway har admin write amalidan so'ng shu yerga
 * yozadi (actor+ip gatewayда ma'lum). Faqat qo'shiladi (immutable) — tahrir/
 * o'chirish patterni YO'Q.
 */
@Controller()
@UseFilters(RpcHttpExceptionFilter)
export class AuditController {
  constructor(
    private readonly activityLog: ActivityLogService,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

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

  /** BE-27: har yozuvda `actorName` (FE-12: «Nodira K.»); tizim amali yoki o‘chirilgan foydalanuvchi — null. */
  @MessagePattern({ cmd: 'identity.audit.list' })
  async list(@Payload() data: { query?: ActivityLogQuery }) {
    const page = await this.activityLog.list(data?.query ?? {});
    const ids = [
      ...new Set(page.items.map((i) => i.actorId).filter((id) => !!id)),
    ] as string[];
    const names = new Map(
      (ids.length
        ? await this.users.find({
            where: { id: In(ids) },
            select: { id: true, name: true },
          })
        : []
      ).map((u) => [String(u.id), u.name?.trim() || null]),
    );
    return {
      ...page,
      items: page.items.map((item) => ({
        ...item,
        actorName: item.actorId
          ? (names.get(String(item.actorId)) ?? null)
          : null,
      })),
    };
  }
}
