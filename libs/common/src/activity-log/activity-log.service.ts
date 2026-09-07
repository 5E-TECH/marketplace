import { Injectable } from '@nestjs/common';
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
    const qb = this.repo
      .createQueryBuilder('log')
      .where('log.is_deleted = FALSE');

    if (query?.actorId) {
      qb.andWhere('log.actor_id = :actorId', { actorId: query.actorId });
    }
    if (query?.action?.trim()) {
      qb.andWhere('log.action = :action', { action: query.action.trim() });
    }
    if (query?.dateFrom) {
      qb.andWhere('log.created_at >= :dateFrom', {
        dateFrom: new Date(query.dateFrom),
      });
    }
    if (query?.dateTo) {
      const dateTo = new Date(
        query.dateTo.length === 10
          ? `${query.dateTo}T23:59:59.999Z`
          : query.dateTo,
      );
      qb.andWhere('log.created_at <= :dateTo', { dateTo });
    }

    qb.orderBy('log.created_at', 'DESC')
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
