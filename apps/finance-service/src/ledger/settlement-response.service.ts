import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import {
  moneyFromDb,
  SettlementDisputeDto,
  SettlementDisputePageDto,
  SettlementDisputeQueryDto,
  SettlementDisputeStatus,
  WholesalerActDto,
  WholesalerSettlementStatus,
} from '@app/common';
import { SettlementService } from './settlement.service';

const ID = /^\d{1,19}$/;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

const DISPUTE_SELECT = `SELECT d.id::text, d.settlement_id::text AS "settlementId", d.wholesaler_id AS "wholesalerId",
       d.comment, d.created_by AS "createdBy", d.created_at AS "createdAt", d.status, d.answer,
       d.answered_by AS "answeredBy", d.answered_at AS "answeredAt"
  FROM finance.settlement_dispute d`;

type DisputeRow = Omit<SettlementDisputeDto, 'settlementNumber'>;

const toDispute = (r: DisputeRow): SettlementDisputeDto => ({
  ...r,
  settlementNumber: `AS-${r.settlementId.padStart(6, '0')}`,
});

/**
 * Aktning hozirgi o‘tkazma summasi: bank faylida muzlatilgani, bo‘lmasa summa − qarz ushlanishi (NETTED da
 * exported_total yozilmaydi — BE-33 `freeze`). Qabul faqat qabul qilingan summa shunga teng bo‘lsa amalda.
 */
const PAYOUT = `COALESCE(s.exported_total, GREATEST(s.total_amount - s.debt_deducted, 0))`;
const ACCEPTED_VALID = `s.accepted_at IS NOT NULL AND s.accepted_total = ${PAYOUT}`;

function validId(value: unknown, field = 'id'): string {
  const s = String(value ?? '');
  if (!ID.test(s)) throw new BadRequestException(`${field} noto‘g‘ri`);
  return s;
}

/** Optovikka platforma xodimlarining ichki ID lari ko‘rsatilmaydi (kim to‘ladi, kim javob berdi). */
function forWholesaler(act: WholesalerActDto): WholesalerActDto {
  return {
    ...act,
    settlement: { ...act.settlement, paidBy: null },
    disputes: act.disputes.map((d) => ({ ...d, answeredBy: null })),
  };
}

function validComment(value: unknown): string {
  const s = String(value ?? '').trim();
  if (s.length < 3 || s.length > 2000)
    throw new BadRequestException('Izoh majburiy (3–2000 belgi)');
  return s;
}

/**
 * BE-46 (FE-24, OPT-3, DZ-08): optovik akt-sverkani qabul qiladi yoki e’tiroz bildiradi; moliya javob beradi.
 * - Optovik faqat o‘z aktini ko‘radi va javob beradi — boshqasi 403 (TC4). Optovik ID si gateway da foydalanuvchidan
 *   (catalog.shop.owner_user_id) olinadi, so‘rovdan emas.
 * - Qabul — bir marta (takror — o‘sha natija); ochiq e’tiroz bo‘lsa qabul qilinmaydi; qabul qilingan aktga e’tiroz yo‘q.
 *   Qabul summaga bog‘liq: bank faylida summa o‘zgarsa (BE-33 `freeze` — qaytgan tovar, qarz), eski qabul amalda emas —
 *   optovik yangi summani qayta qabul qiladi yoki e’tiroz bildiradi.
 * - Bir aktda bir vaqtda bitta ochiq e’tiroz; javobdan keyin optovik qabul qiladi yoki yana e’tiroz bildiradi.
 * - «Tovarlar qaytdi» (VOID) aktida javob yo‘q — o‘tkazma ham yo‘q.
 * - To‘lov qabulni kutmaydi [taklif, BE-46 savol 4]: akt holati (READY → … → PAID) bu yerda o‘zgarmaydi.
 */
@Injectable()
export class SettlementResponseService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly settlements: SettlementService,
  ) {}

  /** Optovik uchun akt: egasi tekshiriladi (403). */
  async wholesalerGet(input: {
    id?: string;
    wholesalerId?: string;
  }): Promise<WholesalerActDto> {
    const id = validId(input?.id);
    const wholesalerId = validId(input?.wholesalerId, 'wholesalerId');
    await this.owned(this.dataSource.manager, id, wholesalerId, false);
    return forWholesaler(await this.act(id));
  }

  async accept(input: {
    id?: string;
    wholesalerId?: string;
    userId?: string;
  }): Promise<WholesalerActDto> {
    const id = validId(input?.id);
    const wholesalerId = validId(input?.wholesalerId, 'wholesalerId');
    const userId = validId(input?.userId, 'userId');
    await this.dataSource.transaction(async (m) => {
      const s = await this.owned(m, id, wholesalerId, true);
      if (s.accepted) return; // takror — o‘sha natija
      this.assertNotVoid(s.status);
      const [open] = (await m.query(
        `SELECT 1 FROM finance.settlement_dispute WHERE settlement_id = $1 AND status = 'OPEN'`,
        [id],
      )) as unknown[];
      if (open)
        throw new ConflictException(
          'E’tirozga moliya javobi kutilmoqda — keyin qabul qiling',
        );
      await m.query(
        `UPDATE finance.wholesaler_settlement s
            SET accepted_by = $2, accepted_at = now(), updated_at = now(), accepted_total = ${PAYOUT}
          WHERE s.id = $1`,
        [id, userId],
      );
    });
    return forWholesaler(await this.act(id));
  }

  async dispute(input: {
    id?: string;
    wholesalerId?: string;
    userId?: string;
    comment?: string;
  }): Promise<WholesalerActDto> {
    const id = validId(input?.id);
    const wholesalerId = validId(input?.wholesalerId, 'wholesalerId');
    const userId = validId(input?.userId, 'userId');
    const comment = validComment(input?.comment);
    await this.dataSource.transaction(async (m) => {
      const s = await this.owned(m, id, wholesalerId, true);
      if (s.accepted)
        throw new ConflictException('Akt qabul qilingan — e’tiroz yo‘q');
      this.assertNotVoid(s.status);
      const [open] = (await m.query(
        `SELECT 1 FROM finance.settlement_dispute WHERE settlement_id = $1 AND status = 'OPEN'`,
        [id],
      )) as unknown[];
      if (open)
        throw new ConflictException(
          'Bu aktda ochiq e’tiroz bor — moliya javobini kuting',
        );
      await m.query(
        `INSERT INTO finance.settlement_dispute (settlement_id, wholesaler_id, comment, created_by)
         VALUES ($1, $2, $3, $4)`,
        [id, wholesalerId, comment, userId],
      );
    });
    return forWholesaler(await this.act(id));
  }

  /** Moliya uchun e’tirozlar ro‘yxati (ochiqlari birinchi, eskisi oldin). */
  async disputes(input: {
    query?: SettlementDisputeQueryDto;
  }): Promise<SettlementDisputePageDto> {
    const q = input?.query ?? {};
    if (
      q.status !== undefined &&
      !Object.values(SettlementDisputeStatus).includes(q.status)
    )
      throw new BadRequestException('status noto‘g‘ri');
    const settlementId =
      q.settlementId === undefined
        ? null
        : validId(q.settlementId, 'settlementId');
    const page = Math.max(1, Math.trunc(Number(q.page)) || 1);
    const limit = Math.min(
      MAX_LIMIT,
      Math.max(1, Math.trunc(Number(q.limit)) || DEFAULT_LIMIT),
    );
    const offset = (page - 1) * limit;
    if (!Number.isSafeInteger(offset))
      throw new BadRequestException('page juda katta');
    const [{ total }] = (await this.dataSource.query(
      `SELECT COUNT(*)::int AS total FROM finance.settlement_dispute d
        WHERE ($1::text IS NULL OR d.status = $1) AND ($2::bigint IS NULL OR d.settlement_id = $2)`,
      [q.status ?? null, settlementId],
    )) as Array<{ total: number }>;
    const rows = (await this.dataSource.query(
      `${DISPUTE_SELECT} WHERE ($1::text IS NULL OR d.status = $1) AND ($2::bigint IS NULL OR d.settlement_id = $2)
        ORDER BY (d.status = 'OPEN') DESC, d.created_at, d.id
        LIMIT ${limit} OFFSET ${offset}`,
      [q.status ?? null, settlementId],
    )) as DisputeRow[];
    return {
      items: rows.map(toDispute),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async answer(input: {
    id?: string;
    userId?: string;
    comment?: string;
  }): Promise<SettlementDisputeDto> {
    const id = validId(input?.id);
    const userId = validId(input?.userId, 'userId');
    const comment = validComment(input?.comment);
    return this.dataSource.transaction(async (m) => {
      const [d] = (await m.query(
        `SELECT status FROM finance.settlement_dispute WHERE id = $1 FOR UPDATE`,
        [id],
      )) as Array<{ status: SettlementDisputeStatus }>;
      if (!d) throw new NotFoundException('E’tiroz topilmadi');
      if (d.status !== SettlementDisputeStatus.OPEN)
        throw new ConflictException('E’tirozga allaqachon javob berilgan');
      await m.query(
        `UPDATE finance.settlement_dispute
            SET status = 'ANSWERED', answer = $2, answered_by = $3, answered_at = now()
          WHERE id = $1`,
        [id, comment, userId],
      );
      const [row] = (await m.query(`${DISPUTE_SELECT} WHERE d.id = $1`, [
        id,
      ])) as DisputeRow[];
      return toDispute(row);
    });
  }

  /** Moliya va admin uchun akt va javoblar. */
  adminGet(input: { id?: string }): Promise<WholesalerActDto> {
    return this.act(validId(input?.id));
  }

  /** Akt va optovik javoblari. */
  private async act(id: string): Promise<WholesalerActDto> {
    const settlement = await this.settlements.get({ id });
    const [s] = (await this.dataSource.query(
      `SELECT s.accepted_at AS "acceptedAt", s.accepted_by AS "acceptedBy", s.accepted_total::text AS "acceptedAmount"
         FROM finance.wholesaler_settlement s WHERE s.id = $1 AND ${ACCEPTED_VALID}`,
      [id],
    )) as Array<{
      acceptedAt: Date;
      acceptedBy: string;
      acceptedAmount: string;
    }>;
    const disputes = (await this.dataSource.query(
      `${DISPUTE_SELECT} WHERE d.settlement_id = $1 ORDER BY d.created_at, d.id`,
      [id],
    )) as DisputeRow[];
    return {
      settlement,
      acceptedAt: s?.acceptedAt ?? null,
      acceptedBy: s?.acceptedBy ?? null,
      acceptedAmount: s ? moneyFromDb(s.acceptedAmount) : null,
      disputes: disputes.map(toDispute),
    };
  }

  /** Akt egasini tekshiradi: yo‘q — 404, boshqa optovikniki — 403. `lock` — qabul/e’tiroz uchun qator qulfi. */
  private async owned(
    m: EntityManager,
    id: string,
    wholesalerId: string,
    lock: boolean,
  ): Promise<{ status: WholesalerSettlementStatus; accepted: boolean }> {
    const [s] = (await m.query(
      `SELECT s.wholesaler_id AS "wholesalerId", s.status, (${ACCEPTED_VALID}) AS accepted
         FROM finance.wholesaler_settlement s WHERE s.id = $1${lock ? ' FOR UPDATE' : ''}`,
      [id],
    )) as Array<{
      wholesalerId: string;
      status: WholesalerSettlementStatus;
      accepted: boolean;
    }>;
    if (!s) throw new NotFoundException('Akt topilmadi');
    if (s.wholesalerId !== wholesalerId)
      throw new ForbiddenException('Bu akt boshqa optovikniki');
    return s;
  }

  private assertNotVoid(status: WholesalerSettlementStatus): void {
    if (status === WholesalerSettlementStatus.VOID)
      throw new ConflictException(
        'Tovarlar qaytgan akt — o‘tkazma yo‘q, javob kerak emas',
      );
  }
}
