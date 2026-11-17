import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import PDFDocument from 'pdfkit';
import { DataSource, EntityManager } from 'typeorm';
import {
  ErrorCode,
  moneyFromDb,
  returningRows,
  runAsLeader,
  SettlementRunResultDto,
  WholesalerSettlementDto,
  WholesalerSettlementPageDto,
  WholesalerSettlementQueryDto,
  WholesalerSettlementStatus,
} from '@app/common';
import { Line, LedgerService } from './ledger.service';

const ID = /^\d{1,19}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
export const SKIPPED_NO_WINDOW = 'RETURN_WINDOW_NOT_SET';

export interface SettlementFile {
  fileName: string;
  contentType: string;
  base64: string;
}

interface Row {
  id: string;
  wholesalerId: string;
  periodStart: string;
  periodEnd: string;
  returnWindowDays: number;
  status: WholesalerSettlementStatus;
  totalAmount: string;
  createdAt: Date;
  paidAt: Date | null;
  paidBy: string | null;
}

const SELECT = `SELECT s.id::text, s.wholesaler_id AS "wholesalerId",
       to_char(s.period_start, 'YYYY-MM-DD') AS "periodStart", to_char(s.period_end, 'YYYY-MM-DD') AS "periodEnd",
       s.return_window_days AS "returnWindowDays", s.status, s.total_amount::text AS "totalAmount",
       s.created_at AS "createdAt", s.paid_at AS "paidAt", s.paid_by AS "paidBy"
  FROM finance.wholesaler_settlement s`;

const actNumber = (id: string) => `AS-${id.padStart(6, '0')}`;
/** Mingliklar bo‘sh joy bilan (12 345 678); ru-RU ning maxsus bo‘sh joylari oddiy probelga almashtiriladi. */
const fmt = (n: number) =>
  n.toLocaleString('ru-RU').replace(/[\u00a0\u202f]/g, ' ');

/**
 * Bank to‘lov topshiriqnomasi fayli — format almashtiriladigan (bank tanlanmagan, TZ T7 «to‘lov topshiriqnomasi
 * fayli» — T02:166). Hozirgisi: dizayn `hujjat-bank-fayli` dagi 11 ustunli CSV (UTF-8 BOM, «;») [taklif — bank
 * tasdiqlaydi]. Rekvizitlar (to‘lovchi — platforma, oluvchi — optovik) BE-07/EQ-05 dan keyin; hozir bo‘sh.
 */
export interface BankFileFormat {
  build(
    rows: Array<{
      number: string;
      date: string;
      wholesalerId: string;
      amount: number;
      purpose: string;
    }>,
  ): SettlementFile;
}

export const csvBankFile: BankFileFormat = {
  build(rows) {
    const esc = (v: string) =>
      /[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
    const header = [
      'Hujjat raqami',
      'Sana',
      'To‘lovchi h/r',
      'To‘lovchi MFO',
      'Oluvchi',
      'Oluvchi STIR',
      'Oluvchi h/r',
      'Oluvchi MFO',
      'Summa',
      'To‘lov maqsadi kodi',
      'To‘lov maqsadi',
    ];
    const lines = rows.map((r) =>
      [
        r.number,
        r.date,
        '',
        '',
        `Optovik #${r.wholesalerId}`,
        '',
        '',
        '',
        String(r.amount),
        '',
        r.purpose,
      ]
        .map(esc)
        .join(';'),
    );
    const csv = '﻿' + [header.join(';'), ...lines].join('\r\n') + '\r\n';
    return {
      fileName: `bank-topshiriqnoma_${rows[0]?.date ?? 'bosh'}.csv`,
      contentType: 'text/csv; charset=utf-8',
      base64: Buffer.from(csv, 'utf8').toString('base64'),
    };
  },
};

/**
 * BE-33: optovik bilan haftalik hisob-kitob (MOL-7; T01:117 «haftalik avtomatik o‘tkazma: sotilgan va qaytarish muddati
 * o‘tgan tovarlar uchun, akt-sverka bilan»).
 * - Har dushanba 09:00 Toshkent (lider qulfi bilan): kesish — shu dushanba 00:00 Toshkent; aktga optovikning
 *   WHOLESALER_BASE yozuvlari kiradi: Elchi puli kelgan (AVAILABLE), teskari qilinmagan, yetkazilganiga qaytarish
 *   muddati (EQ-10, `finance.setting.return_window_days`) to‘lgan, avval aktga kirmagan, buyurtmasida hal
 *   qilinmagan xato (event_failure, masalan qisman qaytarish) yo‘q.
 * - Muddat sozlanmagan bo‘lsa akt tuzilmaydi (manbasiz sukut yo‘q).
 * - «To‘landi» (moliya bankda o‘tkazgach): qulf ostida qaytarilgan qatorlar chiqariladi, summa qayta hisoblanadi,
 *   ledgerga WHOLESALER_PAID jurnali (WHOLESALER −summa, COD_CLEARING +summa).
 */
@Injectable()
export class SettlementService {
  private readonly logger = new Logger(SettlementService.name);
  bankFormat: BankFileFormat = csvBankFile;

  constructor(
    private readonly db: DataSource,
    private readonly ledger: LedgerService,
  ) {}

  @Cron('0 0 9 * * 1', {
    name: 'finance-wholesaler-settlement',
    timeZone: 'Asia/Tashkent',
    waitForCompletion: true,
  })
  async weekly(): Promise<void> {
    const res = await runAsLeader(
      this.db,
      'finance-wholesaler-settlement',
      () => this.run({}),
    );
    if (res.ran && res.result.skipped)
      this.logger.warn(`Optovik hisob-kitobi tuzilmadi: ${res.result.skipped}`);
  }

  private async returnWindowDays(
    m: EntityManager,
    at: Date,
  ): Promise<number | null> {
    const [row] = (await m.query(
      `SELECT value FROM finance.setting
        WHERE key = 'return_window_days' AND effective_from <= $1
        ORDER BY effective_from DESC LIMIT 1`,
      [at],
    )) as Array<{ value: string }>;
    if (!row) return null;
    const n = Number(row.value);
    return Number.isSafeInteger(n) && n >= 0 ? n : null;
  }

  /** Hisob-kitob (cron yoki qo‘lda). Takror ishga tushirish xavfsiz: bir yozuv bir marta, bir optovik-davr bir akt. */
  async run(input: { asOf?: string }): Promise<SettlementRunResultDto> {
    const asOf = input?.asOf ? new Date(input.asOf) : new Date();
    if (Number.isNaN(asOf.getTime()))
      throw new BadRequestException('asOf noto‘g‘ri');
    return this.db.transaction(async (m) => {
      // Kesish: shu haftaning dushanbasi 00:00 (Toshkent); davr — oldingi dushanba–yakshanba
      const [{ cutoff, periodStart, periodEnd }] = (await m.query(
        `SELECT (date_trunc('week', $1::timestamptz AT TIME ZONE 'Asia/Tashkent') AT TIME ZONE 'Asia/Tashkent') AS cutoff,
                to_char(date_trunc('week', $1::timestamptz AT TIME ZONE 'Asia/Tashkent') - interval '7 days', 'YYYY-MM-DD') AS "periodStart",
                to_char(date_trunc('week', $1::timestamptz AT TIME ZONE 'Asia/Tashkent') - interval '1 day', 'YYYY-MM-DD') AS "periodEnd"`,
        [asOf],
      )) as Array<{ cutoff: Date; periodStart: string; periodEnd: string }>;
      const days = await this.returnWindowDays(m, asOf);
      if (days === null)
        return {
          periodEnd,
          skipped: SKIPPED_NO_WINDOW,
          settlements: 0,
          items: 0,
        };
      const due = (await m.query(
        `SELECT e.id::text AS "entryId", a.owner_id AS "wholesalerId", j.order_id AS "orderId",
                e.product_id AS "productId", e.quantity, e.amount::text AS amount, j.occurred_at AS "deliveredAt"
           FROM finance.ledger_entry e
           JOIN finance.account a ON a.id = e.account_id AND a.type = 'WHOLESALER'
           JOIN finance.journal j ON j.id = e.journal_id AND j.kind = 'ORDER_DELIVERED'
          WHERE e.line_kind = 'WHOLESALER_BASE' AND e.state = 'AVAILABLE' AND e.reverses_entry_id IS NULL
            AND j.occurred_at + make_interval(days => $2) <= $1
            AND NOT EXISTS (SELECT 1 FROM finance.wholesaler_settlement_item i WHERE i.entry_id = e.id)
            AND NOT EXISTS (SELECT 1 FROM finance.event_failure f WHERE f.payload->>'orderId' = j.order_id)
          ORDER BY a.owner_id, j.occurred_at, e.id
          FOR UPDATE OF e`,
        [cutoff, days],
      )) as Array<{
        entryId: string;
        wholesalerId: string;
        orderId: string;
        productId: string | null;
        quantity: number | null;
        amount: string;
        deliveredAt: Date;
      }>;
      const byWholesaler = new Map<string, typeof due>();
      for (const d of due) {
        const list = byWholesaler.get(d.wholesalerId) ?? [];
        list.push(d);
        byWholesaler.set(d.wholesalerId, list);
      }
      let settlements = 0;
      let items = 0;
      for (const [wholesalerId, list] of byWholesaler) {
        await m.query(
          `INSERT INTO finance.wholesaler_settlement (wholesaler_id, period_start, period_end, return_window_days)
           VALUES ($1, $2, $3, $4) ON CONFLICT (wholesaler_id, period_end) DO NOTHING`,
          [wholesalerId, periodStart, periodEnd, days],
        );
        const [s] = (await m.query(
          `SELECT id::text, status FROM finance.wholesaler_settlement
            WHERE wholesaler_id = $1 AND period_end = $2 FOR UPDATE`,
          [wholesalerId, periodEnd],
        )) as Array<{ id: string; status: WholesalerSettlementStatus }>;
        // Shu davr akti allaqachon to‘langan — yangi qatorlar keyingi haftaga qoladi
        if (s.status !== WholesalerSettlementStatus.READY) continue;
        for (const d of list)
          await m.query(
            `INSERT INTO finance.wholesaler_settlement_item
               (settlement_id, entry_id, order_id, product_id, quantity, amount, delivered_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
              s.id,
              d.entryId,
              d.orderId,
              d.productId,
              d.quantity,
              d.amount,
              d.deliveredAt,
            ],
          );
        await this.recalc(m, s.id);
        settlements++;
        items += list.length;
      }
      return { periodEnd, skipped: null, settlements, items };
    });
  }

  private async recalc(m: EntityManager, id: string): Promise<number> {
    const [row] = returningRows<{ total: string }>(
      await m.query(
        `UPDATE finance.wholesaler_settlement s
            SET total_amount = COALESCE((SELECT SUM(amount) FROM finance.wholesaler_settlement_item i WHERE i.settlement_id = s.id), 0),
                updated_at = now()
          WHERE s.id = $1 RETURNING total_amount::text AS total`,
        [id],
      ),
    );
    return moneyFromDb(row?.total);
  }

  async list(input: {
    query: WholesalerSettlementQueryDto;
  }): Promise<WholesalerSettlementPageDto> {
    const q = input?.query ?? {};
    const page = Math.max(1, Math.trunc(Number(q.page)) || 1);
    const limit = Math.min(
      MAX_LIMIT,
      Math.max(1, Math.trunc(Number(q.limit)) || DEFAULT_LIMIT),
    );
    const offset = (page - 1) * limit;
    if (!Number.isSafeInteger(offset))
      throw new BadRequestException('page juda katta');
    if (q.wholesalerId !== undefined && !ID.test(String(q.wholesalerId)))
      throw new BadRequestException('wholesalerId noto‘g‘ri');
    if (q.periodEnd !== undefined && !DAY.test(String(q.periodEnd)))
      throw new BadRequestException('periodEnd: YYYY-MM-DD');
    if (
      q.status !== undefined &&
      !Object.values(WholesalerSettlementStatus).includes(q.status)
    )
      throw new BadRequestException('status noto‘g‘ri');
    const where = `($1::text IS NULL OR s.status = $1) AND ($2::text IS NULL OR s.wholesaler_id = $2)
       AND ($3::date IS NULL OR s.period_end = $3::date)`;
    const params = [
      q.status ?? null,
      q.wholesalerId ?? null,
      q.periodEnd ?? null,
    ];
    const [{ total }] = (await this.db.query(
      `SELECT count(*)::int AS total FROM finance.wholesaler_settlement s WHERE ${where}`,
      params,
    )) as Array<{ total: number }>;
    const rows = (await this.db.query(
      `${SELECT} WHERE ${where} ORDER BY s.period_end DESC, s.id DESC LIMIT $4 OFFSET $5`,
      [...params, limit, offset],
    )) as Row[];
    return {
      items: await this.toDtos(this.db.manager, rows),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async get(input: { id: string }): Promise<WholesalerSettlementDto> {
    const id = this.validId(input?.id);
    const [row] = (await this.db.query(`${SELECT} WHERE s.id = $1`, [
      id,
    ])) as Row[];
    if (!row) throw new NotFoundException('Akt topilmadi');
    return (await this.toDtos(this.db.manager, [row]))[0];
  }

  /**
   * «To‘landi»: moliya bankda o‘tkazdi. Qulf ostida: qaytarilgan (endi AVAILABLE emas) qatorlar aktdan chiqariladi,
   * summa qayta hisoblanadi; optovik mavjud balansi yetishi tekshiriladi; ledgerga WHOLESALER_PAID jurnali.
   * Takror bosilsa — o‘sha natija.
   */
  async markPaid(input: {
    id: string;
    paidBy: string;
  }): Promise<WholesalerSettlementDto> {
    const id = this.validId(input?.id);
    const paidBy = String(input?.paidBy ?? '');
    if (!ID.test(paidBy)) throw new BadRequestException('paidBy noto‘g‘ri');
    await this.db.transaction(async (m) => {
      const [s] = (await m.query(`${SELECT} WHERE s.id = $1 FOR UPDATE`, [
        id,
      ])) as Row[];
      if (!s) throw new NotFoundException('Akt topilmadi');
      if (s.status === WholesalerSettlementStatus.PAID) return;
      const whAcc = await this.ledger.accountId(
        m,
        'WHOLESALER',
        s.wholesalerId,
      );
      const cod = await this.ledger.accountId(m, 'COD_CLEARING', '');
      await this.ledger.lockAccounts(m, [whAcc, cod]);
      await m.query(
        `DELETE FROM finance.wholesaler_settlement_item i
          USING finance.ledger_entry e
          WHERE i.settlement_id = $1 AND e.id = i.entry_id AND e.state <> 'AVAILABLE'`,
        [id],
      );
      const total = await this.recalc(m, id);
      if (total <= 0)
        throw new ConflictException({
          message: 'To‘lanadigan summa 0 — aktdagi tovarlar qaytarilgan',
          errorCode: ErrorCode.INVALID_STATE,
        });
      const [{ available }] = (await m.query(
        `SELECT available_balance::text AS available FROM finance.account WHERE id = $1`,
        [whAcc],
      )) as Array<{ available: string }>;
      if (moneyFromDb(available) < total)
        throw new ConflictException({
          message: `Optovik mavjud balansi ${moneyFromDb(available)} so‘m, akt ${total} — qaytarishdan keyingi qarz bor`,
          errorCode: ErrorCode.INVALID_STATE,
        });
      const reference = `settlement:${id}`;
      const lines: Line[] = [
        {
          account: 'WHOLESALER',
          ownerId: s.wholesalerId,
          lineKind: 'WHOLESALER_PAYOUT',
          itemSeq: 0,
          productId: null,
          amount: -total,
        },
        {
          account: 'COD_CLEARING',
          ownerId: '',
          lineKind: 'WHOLESALER_PAYOUT',
          itemSeq: 0,
          productId: null,
          amount: total,
        },
      ];
      const journalId = await this.ledger.writeJournal(
        m,
        {
          kind: 'WHOLESALER_PAID',
          referenceId: reference,
          orderId: null,
          eventId: reference,
          occurredAt: new Date().toISOString(),
          gross: total,
        },
        lines,
        'AVAILABLE',
      );
      if (!journalId)
        throw new Error(
          `settlement ${id}: jurnal allaqachon bor, holat PAID emas`,
        );
      await m.query(
        `UPDATE finance.wholesaler_settlement
            SET status = 'PAID', paid_by = $2, paid_at = now(), journal_id = $3, updated_at = now()
          WHERE id = $1`,
        [id, paidBy, journalId],
      );
    });
    return this.get({ id });
  }

  /** Akt-sverka PDF (dizayn `hujjat-akt-sverka` chizilmagan — tarkib [taklif]). Rekvizitlar BE-07 dan keyin. */
  async actPdf(input: { id: string }): Promise<SettlementFile> {
    const s = await this.get(input);
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });
    doc.fontSize(14).text(`AKT-SVERKA ${s.number}`, { align: 'center' });
    doc.moveDown(0.5).fontSize(10);
    doc.text(`Davr: ${s.periodStart} — ${s.periodEnd}`);
    doc.text(`Optovik: #${s.wholesalerId} (rekvizitlar katalogda — BE-07)`);
    doc.text(
      `Qaytarish muddati: ${s.returnWindowDays} kun; aktga Elchi puli kelgan va muddati o‘tgan tovarlar kiradi.`,
    );
    doc.text(
      `Holat: ${s.status === WholesalerSettlementStatus.PAID ? `To‘landi (${s.paidAt?.toISOString().slice(0, 10)})` : 'To‘lovga tayyor'}`,
    );
    doc.moveDown();
    doc.text('Buyurtma | Tovar | Soni | Yetkazilgan | Summa, so‘m');
    for (const i of s.items)
      doc.text(
        `${i.orderId} | ${i.productId ?? '—'} | ${i.quantity ?? '—'} | ${new Date(i.deliveredAt).toISOString().slice(0, 10)} | ${fmt(i.amount)}`,
      );
    doc
      .moveDown()
      .fontSize(12)
      .text(`Jami o‘tkaziladi: ${fmt(s.totalAmount)} so‘m`, { align: 'right' });
    doc.end();
    const pdf = await done;
    return {
      fileName: `akt-sverka_${s.number}_${s.periodEnd}.pdf`,
      contentType: 'application/pdf',
      base64: pdf.toString('base64'),
    };
  }

  /** Bank fayli: davrning «To‘lovga tayyor» aktlari (0 so‘mlik akt kirmaydi). */
  async bankFile(input: { periodEnd: string }): Promise<SettlementFile> {
    const periodEnd = String(input?.periodEnd ?? '');
    if (!DAY.test(periodEnd))
      throw new BadRequestException('periodEnd: YYYY-MM-DD');
    const rows = (await this.db.query(
      `${SELECT} WHERE s.period_end = $1::date AND s.status = 'READY' AND s.total_amount > 0 ORDER BY s.id`,
      [periodEnd],
    )) as Row[];
    if (!rows.length)
      throw new NotFoundException('Bu davrda to‘lovga tayyor akt yo‘q');
    const today = new Date().toISOString().slice(0, 10);
    return this.bankFormat.build(
      rows.map((r) => ({
        number: actNumber(r.id),
        date: today,
        wholesalerId: r.wholesalerId,
        amount: moneyFromDb(r.totalAmount),
        purpose: `${r.periodStart}–${r.periodEnd} davr uchun sotilgan tovarlar, akt ${actNumber(r.id)}`,
      })),
    );
  }

  private validId(v: unknown): string {
    const s = String(v ?? '');
    if (!ID.test(s)) throw new BadRequestException('id noto‘g‘ri');
    return s;
  }

  private async toDtos(
    m: EntityManager,
    rows: Row[],
  ): Promise<WholesalerSettlementDto[]> {
    if (!rows.length) return [];
    const items = (await m.query(
      `SELECT settlement_id::text AS "settlementId", order_id AS "orderId", product_id AS "productId",
              quantity, amount::text AS amount, delivered_at AS "deliveredAt"
         FROM finance.wholesaler_settlement_item WHERE settlement_id = ANY($1::bigint[])
        ORDER BY delivered_at, id`,
      [rows.map((r) => r.id)],
    )) as Array<{
      settlementId: string;
      orderId: string;
      productId: string | null;
      quantity: number | null;
      amount: string;
      deliveredAt: Date;
    }>;
    return rows.map((r) => {
      const own = items.filter((i) => i.settlementId === r.id);
      return {
        id: r.id,
        number: actNumber(r.id),
        wholesalerId: r.wholesalerId,
        periodStart: r.periodStart,
        periodEnd: r.periodEnd,
        returnWindowDays: r.returnWindowDays,
        status: r.status,
        totalAmount: moneyFromDb(r.totalAmount),
        itemsCount: own.length,
        items: own.map((i) => ({
          orderId: i.orderId,
          productId: i.productId,
          quantity: i.quantity,
          amount: moneyFromDb(i.amount),
          deliveredAt: i.deliveredAt,
        })),
        createdAt: r.createdAt,
        paidAt: r.paidAt,
        paidBy: r.paidBy,
      };
    });
  }
}
