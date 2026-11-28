import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { LeadOrderStatus, OperatorBonusSettingsDto } from '@app/common';
import { Lead } from './entities';

/** Yetkazilgandan keyin qaytarilgan buyurtma: bonus bekor (BE-44 qaytarish tasdiqlangach). */
export const RETURNED_AFTER_DELIVERY = new Set<LeadOrderStatus>([
  LeadOrderStatus.RETURNING,
  LeadOrderStatus.RETURNED_GRADED,
]);

/**
 * BE-45 TC6 (ega qarori 2026-11-28, EQ-14): operatorga upsell bonusi.
 * - Har qo‘shilgan boshqa tovar (lid qatori `is_upsell`) — bitta bonus, qatorni qo‘shgan operatorga (`added_by`).
 * - Mijoz tovarni olganda (buyurtma yetkazildi) yoziladi; summa — shu paytdagi sozlama; 0 bo‘lsa yozilmaydi.
 * - Rad etilgan (mijoz olmagan) buyurtmada bonus yo‘q; yetkazilgandan keyin qaytarilsa — bekor qilinadi.
 * - Ish haqi bilan to‘lanadi (TZ 2.5) — tizim faqat hisoblab ko‘rsatadi (operator statistikasi). Davr hisobi: o‘sha davrda
 *   yozilgan bonuslar minus o‘sha davrda bekor qilinganlari — o‘tgan (to‘langan) davr keyin o‘zgarmaydi, qaytarish
 *   qaytarilgan davrda ayiriladi.
 */
@Injectable()
export class OperatorBonusService {
  constructor(private readonly db: DataSource) {}

  async settings(): Promise<OperatorBonusSettingsDto> {
    const [row] = (await this.db.query(
      `SELECT upsell_bonus::text AS "upsellBonus", updated_by::text AS "updatedBy", updated_at AS "updatedAt"
         FROM lead.operator_bonus_setting WHERE id = 1`,
    )) as Array<{
      upsellBonus: string;
      updatedBy: string | null;
      updatedAt: Date | null;
    }>;
    return {
      upsellBonus: Number(row?.upsellBonus ?? 0),
      updatedBy: row?.updatedBy ?? null,
      updatedAt: row?.updatedAt ? new Date(row.updatedAt).toISOString() : null,
    };
  }

  async updateSettings(
    actorId: string,
    upsellBonus: number,
  ): Promise<OperatorBonusSettingsDto> {
    await this.db.query(
      `INSERT INTO lead.operator_bonus_setting (id, upsell_bonus, updated_by, updated_at)
       VALUES (1, $1, $2, now())
       ON CONFLICT (id) DO UPDATE
         SET upsell_bonus = EXCLUDED.upsell_bonus, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [upsellBonus, /^\d{1,19}$/.test(String(actorId)) ? actorId : null],
    );
    return this.settings();
  }

  /** Buyurtma yetkazildi — lidning qo‘shimcha qatorlari uchun bonus (bir qatorga bir marta). Lid qatori qulflangan. */
  async earn(manager: EntityManager, lead: Lead, at: Date): Promise<number> {
    if (lead.orderStatus && RETURNED_AFTER_DELIVERY.has(lead.orderStatus))
      return 0; // qaytarish hodisasi «yetkazildi» dan oldin kelgan — bonus yo‘q
    const [setting] = (await manager.query(
      `SELECT upsell_bonus::text AS amount FROM lead.operator_bonus_setting WHERE id = 1`,
    )) as Array<{ amount: string }>;
    const amount = Number(setting?.amount ?? 0);
    if (!(amount > 0)) return 0;
    const inserted = (await manager.query(
      `INSERT INTO lead.operator_bonus
         (kind, lead_id, lead_item_id, operator_id, product_id, order_id, amount, earned_at)
       SELECT 'UPSELL', i.lead_id, i.id, i.added_by, i.product_id, $2, $3, $4
         FROM lead.lead_item i
        WHERE i.lead_id = $1 AND i.is_upsell AND i.added_by IS NOT NULL
       ON CONFLICT (kind, lead_item_id) DO NOTHING
       RETURNING id`,
      [lead.id, lead.orderId, amount, at],
    )) as unknown[];
    return inserted.length;
  }

  /** Birinchi ishlangan hodisa keyingi holat bo‘lsa (REMITTED oldin kelgan), bonus kuni — haqiqiy yetkazilgan kun. */
  async alignEarnedAt(
    manager: EntityManager,
    leadId: string,
    deliveredAt: Date,
  ): Promise<void> {
    await manager.query(
      `UPDATE lead.operator_bonus SET earned_at = $2
        WHERE lead_id = $1 AND earned_at > $2 AND cancelled_at IS NULL`,
      [leadId, deliveredAt],
    );
  }

  /** Yetkazilgan buyurtma qaytarildi — bonuslar bekor (qayta yozilmaydi). */
  async cancel(
    manager: EntityManager,
    leadId: string,
    at: Date,
  ): Promise<void> {
    await manager.query(
      `UPDATE lead.operator_bonus SET cancelled_at = $2
        WHERE lead_id = $1 AND cancelled_at IS NULL`,
      [leadId, at],
    );
  }
}
