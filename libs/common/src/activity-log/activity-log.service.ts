import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ActivityLog } from './activity-log.entity';

export interface ActivityLogInput {
  actorId?: string | null;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  meta?: unknown;
}

export interface ActivityLogQuery {
  actorId?: string;
  action?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  limit?: number;
}

@Injectable()
export class ActivityLogService {
  constructor(
    @InjectRepository(ActivityLog)
    private readonly repo: Repository<ActivityLog>,
  ) {}

  log(input: ActivityLogInput): Promise<ActivityLog> {
    return this.repo.save(this.repo.create(input));
  }

  /** C6.3 — audit jurnalini actor/action/sana bo'yicha o'qish. */
  async list(query: ActivityLogQuery) {
    const page = Math.max(1, Number(query?.page ?? 1));
    const limit = Math.min(100, Math.max(1, Number(query?.limit ?? 20)));
    if (
      !Number.isSafeInteger(page) ||
      !Number.isInteger(limit) ||
      !Number.isSafeInteger((page - 1) * limit)
    ) {
      throw new BadRequestException('Sahifalash qiymatlari noto‘g‘ri');
    }
    if (
      query?.actorId !== undefined &&
      (!/^[1-9]\d{0,18}$/.test(query.actorId) ||
        BigInt(query.actorId) > BigInt('9223372036854775807'))
    ) {
      throw new BadRequestException('actorId musbat bigint bo‘lishi kerak');
    }
    const dateFrom = query?.dateFrom ? new Date(query.dateFrom) : undefined;
    const dateTo = query?.dateTo ? new Date(query.dateTo) : undefined;
    // PostgreSQL mikrosekundlarni saqlaydi: butun kun uchun keyingi kun
    // boshlanishidan kichik qiymatlarni olamiz, oxirgi millisekund bilan cheklamaymiz.
    const dateToIsDay = query?.dateTo?.length === 10;
    if (dateTo && dateToIsDay) dateTo.setUTCDate(dateTo.getUTCDate() + 1);
    if (
      (dateFrom && !Number.isFinite(dateFrom.getTime())) ||
      (dateTo && !Number.isFinite(dateTo.getTime())) ||
      (dateFrom &&
        dateTo &&
        (dateToIsDay ? dateFrom >= dateTo : dateFrom > dateTo))
    ) {
      throw new BadRequestException('Sana oralig‘i noto‘g‘ri');
    }
    const qb = this.repo
      .createQueryBuilder('log')
      .where('log.is_deleted = FALSE');

    if (query?.actorId) {
      qb.andWhere('log.actor_id = :actorId', { actorId: query.actorId });
    }
    if (query?.action?.trim()) {
      qb.andWhere('log.action = :action', { action: query.action.trim() });
    }
    if (dateFrom) {
      qb.andWhere('log.created_at >= :dateFrom', {
        dateFrom,
      });
    }
    if (dateTo) {
      qb.andWhere(`log.created_at ${dateToIsDay ? '<' : '<='} :dateTo`, {
        dateTo,
      });
    }

    qb.orderBy('log.created_at', 'DESC')
      .addOrderBy('log.id', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);
    const [items, total] = await qb.getManyAndCount();
    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }
}
