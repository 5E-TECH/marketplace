import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { BroadcastAudience, Role } from '@app/common';
import { In, MoreThan, Repository } from 'typeorm';
import { User } from '../entities/user.entity';

/** Adminlar ommaviy xabar olmaydi; operator — do'kon xodimi, "hamma"ga kiradi. */
const AUDIENCE_ROLES: Record<BroadcastAudience, Role[]> = {
  all: [Role.BUYER, Role.SELLER, Role.OPERATOR],
  sellers: [Role.SELLER],
  buyers: [Role.BUYER],
};

export interface BroadcastRecipient {
  id: string;
  phone: string;
  email: string | null;
}

/**
 * C6.8 — ommaviy xabar qabul qiluvchilari. Faqat faol, bloklanmagan va
 * o'chirilmagan foydalanuvchi. Ro'yxat id bo'yicha kursor bilan bo'laklab
 * beriladi: notification-service katta auditoriyani RPC chegarasiga
 * urilmasdan, uzilsa shu joydan davom ettirib yuboradi.
 */
@Injectable()
export class BroadcastRecipientsService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  async count(audience: BroadcastAudience): Promise<{ count: number }> {
    return { count: await this.users.count({ where: this.where(audience) }) };
  }

  async page(input: {
    audience: BroadcastAudience;
    afterId?: string | null;
    limit?: number;
  }): Promise<{ items: BroadcastRecipient[]; nextAfterId: string | null }> {
    const limit = Math.min(500, Math.max(1, Number(input.limit ?? 200)));
    const rows = await this.users.find({
      select: { id: true, phone: true, email: true },
      where: {
        ...this.where(input.audience),
        ...(input.afterId ? { id: MoreThan(String(input.afterId)) } : {}),
      },
      order: { id: 'ASC' },
      take: limit,
    });
    const items = rows.map((row) => ({
      id: String(row.id),
      phone: row.phone,
      email: row.email ?? null,
    }));
    return {
      items,
      nextAfterId: items.length === limit ? items[items.length - 1].id : null,
    };
  }

  private where(audience: BroadcastAudience) {
    return {
      role: In(AUDIENCE_ROLES[audience] ?? []),
      isActive: true,
      isBlocked: false,
      isDeleted: false,
    };
  }
}
