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
  registerPdfFonts,
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
/** Davrning bank fayli olingan: yangi akt qayta yuklangan faylga eski aktlar bilan chiqib, ikki marta to‘lanardi. */
export const SKIPPED_PERIOD_EXPORTED = 'PERIOD_ALREADY_EXPORTED';

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
  exportedTotal: string | null;
  debtDeducted: string;
  exportedAt: Date | null;
  createdAt: Date;
  paidAt: Date | null;
  paidBy: string | null;
}

const SELECT = `SELECT s.id::text, s.wholesaler_id AS "wholesalerId",
       to_char(s.period_start, 'YYYY-MM-DD') AS "periodStart", to_char(s.period_end, 'YYYY-MM-DD') AS "periodEnd",
       s.return_window_days AS "returnWindowDays", s.status, s.total_amount::text AS "totalAmount",
       s.exported_total::text AS "exportedTotal", s.debt_deducted::text AS "debtDeducted", s.exported_at AS "exportedAt",
       s.created_at AS "createdAt", s.paid_at AS "paidAt", s.paid_by AS "paidBy"
  FROM finance.wholesaler_settlement s`;

const STATUS_TEXT: Record<WholesalerSettlementStatus, string> = {
  READY: 'Tuzildi, bank fayli olinmagan',
  EXPORTED: 'Bank faylida, to‘lov kutilmoqda',
  PAID: 'To‘landi',
  NETTED: 'Qarzga ushlandi, o‘tkazma yo‘q',
  VOID: 'Tovarlar qaytdi, o‘tkazma yo‘q',
};
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

/** Hal qilinmagan xato: event_failure bor, lekin keyin shu hodisa muvaffaqiyatli ishlanmagan (processed_event yo‘q). */
const OPEN_FAILURE = (orderIdSql: string) => `EXISTS (
  SELECT 1 FROM finance.event_failure f
   WHERE f.payload->>'orderId' = ${orderIdSql}
     AND (f.event_id IS NULL OR NOT EXISTS (
       SELECT 1 FROM finance.processed_event p WHERE p.consumer = f.consumer AND p.event_id = f.event_id)))`;
/** Hisob-kitob ishga tushirish qulfi [taklif]: 2101/2102 lead, 2201 cron, 2301–2303 ledger/withdrawal, 6303 payment band. */
const SETTLEMENT_RUN_LOCK_CLASS = 2304;
/** Kelajak lahzasi bilan ishga tushirib bo‘lmaydi (muddati o‘tmagan tovar kirib qoladi); soat farqi uchun 5 daqiqa. */
const CLOCK_SKEW_MS = 5 * 60_000;

/** Ishga tushirish va bank fayli bir-birini kutadi: fayl olinayotganda davrga yangi akt tuzilmaydi. */
const lockRun = (m: EntityManager) =>
  m.query('SELECT pg_advisory_xact_lock($1, hashtext($2))', [
    SETTLEMENT_RUN_LOCK_CLASS,
    'finance-wholesaler-settlement',
  ]);

function validDay(value: unknown, field: string): string {
  const s = String(value ?? '');
  const d = new Date(`${s}T00:00:00Z`);
  if (
    !DAY.test(s) ||
    Number.isNaN(d.getTime()) ||
    d.toISOString().slice(0, 10) !== s
  )
    throw new BadRequestException(`${field}: YYYY-MM-DD sana kerak`);
  return s;
}

/**
 * BE-33: optovik bilan haftalik hisob-kitob (MOL-7; T01:117 «haftalik avtomatik o‘tkazma: sotilgan va qaytarish muddati
 * o‘tgan tovarlar uchun, akt-sverka bilan»).
 * - Har dushanba 09:00 Toshkent: kesish — shu dushanba 00:00; aktga optovikning WHOLESALER_BASE yozuvlari kiradi:
 *   Elchi puli kelgan (AVAILABLE), teskari qilinmagan, yetkazilganiga qaytarish muddati (EQ-10,
 *   `finance.setting.return_window_days`) to‘lgan, avval aktga kirmagan, buyurtmasida hal qilinmagan xato yo‘q.
 *   Akt tuzilgach o‘zgarmaydi: shu davrga keyin muddati yetgan qator keyingi haftaga qoladi.
 * - Muddat sozlanmagan bo‘lsa akt tuzilmaydi (manbasiz sukut yo‘q).
 * - Bank fayli olingan davr yopiq: biror akti READY dan chiqqan bo‘lsa, `run` shu davrga yangi akt tuzmaydi —
 *   qatorlar keyingi haftaga qoladi (aks holda qayta yuklangan fayl eski aktlarni yana chiqarardi).
 * - Bank fayli (moliya yuklab oladi): har tayyor akt qulf ostida qayta tekshiriladi — qaytgan yoki xatoli qator chiqadi,
 *   oldingi to‘lovlardan keyingi qaytarish qarzi ushlanadi, summa muzlatiladi (EXPORTED, exported_total).
 *   Hammasi qarzga ketsa — NETTED, tovarlar qaytgan bo‘lsa — VOID. Faylda faqat muzlatilgan summa.
 * - «To‘landi»: faqat EXPORTED; ledgerga aynan bank faylidagi summa (WHOLESALER −, COD_CLEARING +). Keyin qaytgan tovar
 *   optovikda qarz bo‘lib qoladi va keyingi aktdan ushlanadi.
 * Qulf tartibi hamma joyda: hisoblar (2301) → akt qatori; run yozuvlarni SKIP LOCKED bilan oladi — hech kimni kutmaydi.
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

  /** Hozirgi vaqt (testda almashtiriladi). */
  protected nowMs(): number {
    return Date.now();
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
    if (asOf.getTime() > this.nowMs() + CLOCK_SKEW_MS)
      throw new BadRequestException('asOf kelajakda bo‘lishi mumkin emas');
    return this.db.transaction(async (m) => {
      await lockRun(m);
      const [{ cutoff, periodStart, periodEnd }] = (await m.query(
        `SELECT (date_trunc('week', $1::timestamptz AT TIME ZONE 'Asia/Tashkent') AT TIME ZONE 'Asia/Tashkent') AS cutoff,
                to_char(date_trunc('week', $1::timestamptz AT TIME ZONE 'Asia/Tashkent') - interval '7 days', 'YYYY-MM-DD') AS "periodStart",
                to_char(date_trunc('week', $1::timestamptz AT TIME ZONE 'Asia/Tashkent') - interval '1 day', 'YYYY-MM-DD') AS "periodEnd"`,
        [asOf],
      )) as Array<{ cutoff: Date; periodStart: string; periodEnd: string }>;
      // Bank fayli olingan davr (READY dan chiqqan akt — EXPORTED, PAID, NETTED yoki VOID) yopiq
      const [closed] = (await m.query(
        `SELECT 1 FROM finance.wholesaler_settlement WHERE period_end = $1::date AND status <> 'READY' LIMIT 1`,
        [periodEnd],
      )) as unknown[];
      if (closed)
        return {
          periodEnd,
          skipped: SKIPPED_PERIOD_EXPORTED,
          settlements: 0,
          items: 0,
        };
      const days = await this.returnWindowDays(m, asOf);
      if (days === null)
        return {
          periodEnd,
          skipped: SKIPPED_NO_WINDOW,
          settlements: 0,
          items: 0,
        };
      // SKIP LOCKED: qaytarish yoki o‘tkazma tranzaksiyasi ushlab turgan qator kutilmaydi — keyingi haftada kiradi
      const due = (await m.query(
        `SELECT e.id::text AS "entryId", a.owner_id AS "wholesalerId", j.order_id AS "orderId",
                e.product_id AS "productId", e.quantity, e.amount::text AS amount, j.occurred_at AS "deliveredAt"
           FROM finance.ledger_entry e
           JOIN finance.account a ON a.id = e.account_id AND a.type = 'WHOLESALER'
           JOIN finance.journal j ON j.id = e.journal_id AND j.kind = 'ORDER_DELIVERED'
          WHERE e.line_kind = 'WHOLESALER_BASE' AND e.state = 'AVAILABLE' AND e.reverses_entry_id IS NULL
            AND j.occurred_at + make_interval(days => $2) <= $1
            AND NOT EXISTS (SELECT 1 FROM finance.wholesaler_settlement_item i WHERE i.entry_id = e.id)
            AND NOT ${OPEN_FAILURE('j.order_id')}
          ORDER BY e.id
          FOR UPDATE OF e SKIP LOCKED`,
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
      for (const [wholesalerId, list] of [...byWholesaler].sort(([a], [b]) =>
        a < b ? -1 : 1,
      )) {
        // Akt o‘zgarmaydi: optovikning shu davr akti allaqachon bo‘lsa, yangi qatorlar keyingi haftaga
        const created = returningRows<{ id: string }>(
          await m.query(
            `INSERT INTO finance.wholesaler_settlement (wholesaler_id, period_start, period_end, return_window_days)
             VALUES ($1, $2, $3, $4) ON CONFLICT (wholesaler_id, period_end) DO NOTHING RETURNING id::text`,
            [wholesalerId, periodStart, periodEnd, days],
          ),
        );
        if (!created.length) continue;
        for (const d of list)
          await m.query(
            `INSERT INTO finance.wholesaler_settlement_item
               (settlement_id, entry_id, order_id, product_id, quantity, amount, delivered_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
              created[0].id,
              d.entryId,
              d.orderId,
              d.productId,
              d.quantity,
              d.amount,
              d.deliveredAt,
            ],
          );
        await this.recalc(m, created[0].id);
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
    if (q.periodEnd !== undefined) validDay(q.periodEnd, 'periodEnd');
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

  /** Optovik hisoblari (2301) → akt qatori: qaytarish va to‘lov bilan bir xil tartib. */
  private async lockFor(
    m: EntityManager,
    wholesalerId: string,
  ): Promise<string> {
    const whAcc = await this.ledger.accountId(m, 'WHOLESALER', wholesalerId);
    const cod = await this.ledger.accountId(m, 'COD_CLEARING', '');
    await this.ledger.lockAccounts(m, [whAcc, cod]);
    return whAcc;
  }

  /**
   * Bank faylidan oldin tayyor aktni muzlatish: qaytgan yoki xatoli qatorlar chiqadi, summa qayta hisoblanadi,
   * oldingi to‘lovlardan keyin qaytgan tovar qarzi ushlanadi.
   * Qarz = optovikning hali to‘lanmagan AVAILABLE qatorlari − (mavjud balans − muzlatilgan, lekin to‘lanmagan aktlar).
   */
  private async freeze(m: EntityManager, s: Row): Promise<void> {
    const whAcc = await this.lockFor(m, s.wholesalerId);
    const [cur] = (await m.query(`${SELECT} WHERE s.id = $1 FOR UPDATE`, [
      s.id,
    ])) as Row[];
    if (cur.status !== WholesalerSettlementStatus.READY) return;
    await m.query(
      `DELETE FROM finance.wholesaler_settlement_item i
        USING finance.ledger_entry e
        WHERE i.settlement_id = $1 AND e.id = i.entry_id
          AND (e.state <> 'AVAILABLE' OR ${OPEN_FAILURE('i.order_id')})`,
      [s.id],
    );
    const total = await this.recalc(m, s.id);
    if (total <= 0) {
      await m.query(
        `UPDATE finance.wholesaler_settlement SET status = 'VOID', updated_at = now() WHERE id = $1`,
        [s.id],
      );
      return;
    }
    const [{ available, pending, unpaid }] = (await m.query(
      `SELECT (SELECT available_balance FROM finance.account WHERE id = $1)::text AS available,
              (SELECT COALESCE(SUM(exported_total), 0) FROM finance.wholesaler_settlement
                WHERE wholesaler_id = $2 AND status = 'EXPORTED')::text AS pending,
              (SELECT COALESCE(SUM(e.amount), 0) FROM finance.ledger_entry e
                WHERE e.account_id = $1 AND e.line_kind = 'WHOLESALER_BASE' AND e.state = 'AVAILABLE'
                  AND e.reverses_entry_id IS NULL
                  AND NOT EXISTS (
                    SELECT 1 FROM finance.wholesaler_settlement_item i
                      JOIN finance.wholesaler_settlement x ON x.id = i.settlement_id
                     WHERE i.entry_id = e.id AND x.status IN ('EXPORTED','PAID','NETTED')))::text AS unpaid`,
      [whAcc, s.wholesalerId],
    )) as Array<{ available: string; pending: string; unpaid: string }>;
    const debt = Math.max(
      0,
      moneyFromDb(unpaid) - (moneyFromDb(available) - moneyFromDb(pending)),
    );
    const exported = Math.max(0, total - debt);
    if (exported > 0)
      await m.query(
        `UPDATE finance.wholesaler_settlement
            SET status = 'EXPORTED', exported_total = $2, debt_deducted = $3, exported_at = now(), updated_at = now()
          WHERE id = $1`,
        [s.id, exported, total - exported],
      );
    else
      await m.query(
        `UPDATE finance.wholesaler_settlement
            SET status = 'NETTED', debt_deducted = $2, updated_at = now() WHERE id = $1`,
        [s.id, total],
      );
  }

  /**
   * Bank fayli (TC3): davrning tayyor aktlari muzlatiladi, faylda — muzlatilgan summalar (oldin muzlatilganlari ham,
   * shuning uchun qayta yuklab olish o‘sha faylni beradi). 0 so‘mlik akt kirmaydi.
   * Ishga tushirish qulfi ostida: fayl olingach `run` davrga yangi akt qo‘sha olmaydi (davr yopiq).
   */
  async bankFile(input: { periodEnd: string }): Promise<SettlementFile> {
    const periodEnd = validDay(input?.periodEnd, 'periodEnd');
    const rows = await this.db.transaction(async (m) => {
      await lockRun(m);
      const ready = (await m.query(
        `${SELECT} WHERE s.period_end = $1::date AND s.status = 'READY' ORDER BY s.wholesaler_id, s.id`,
        [periodEnd],
      )) as Row[];
      for (const s of ready) await this.freeze(m, s);
      return (await m.query(
        `${SELECT} WHERE s.period_end = $1::date AND s.status = 'EXPORTED' ORDER BY s.id`,
        [periodEnd],
      )) as Row[];
    });
    if (!rows.length)
      throw new NotFoundException('Bu davrda to‘lanadigan akt yo‘q');
    const today = new Date().toISOString().slice(0, 10);
    return this.bankFormat.build(
      rows.map((r) => ({
        number: actNumber(r.id),
        date: today,
        wholesalerId: r.wholesalerId,
        amount: moneyFromDb(r.exportedTotal),
        purpose: `${r.periodStart}–${r.periodEnd} davr uchun sotilgan tovarlar, akt ${actNumber(r.id)}`,
      })),
    );
  }

  /**
   * «To‘landi»: moliya bank faylidagi summani o‘tkazdi. Faqat EXPORTED; ledgerga aynan muzlatilgan summa
   * (WHOLESALER −, COD_CLEARING +). Keyin qaytgan tovar optovikda qarz bo‘lib qoladi (keyingi aktdan ushlanadi).
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
      const [head] = (await m.query(`${SELECT} WHERE s.id = $1`, [
        id,
      ])) as Row[];
      if (!head) throw new NotFoundException('Akt topilmadi');
      await this.lockFor(m, head.wholesalerId);
      const [s] = (await m.query(`${SELECT} WHERE s.id = $1 FOR UPDATE`, [
        id,
      ])) as Row[];
      if (s.status === WholesalerSettlementStatus.PAID) return;
      if (s.status !== WholesalerSettlementStatus.EXPORTED)
        throw new ConflictException({
          message: `Akt ${s.status} holatida — «To‘landi» faqat bank faylidan keyin`,
          errorCode: ErrorCode.INVALID_STATE,
        });
      const total = moneyFromDb(s.exportedTotal);
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
    const doc = registerPdfFonts(new PDFDocument({ size: 'A4', margin: 40 }));
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
      `Holat: ${STATUS_TEXT[s.status]}${s.paidAt ? ` (${new Date(s.paidAt).toISOString().slice(0, 10)})` : ''}`,
    );
    doc.moveDown();
    doc.text('Buyurtma | Tovar | Soni | Yetkazilgan | Summa, so‘m');
    for (const i of s.items)
      doc.text(
        `${i.orderId} | ${i.productId ?? '—'} | ${i.quantity ?? '—'} | ${new Date(i.deliveredAt).toISOString().slice(0, 10)} | ${fmt(i.amount)}`,
      );
    doc
      .moveDown()
      .text(`Tovarlar jami: ${fmt(s.totalAmount)} so‘m`, { align: 'right' });
    if (s.debtDeducted > 0)
      doc.text(
        `Oldingi qaytarishlar qarzi ushlandi: ${fmt(s.debtDeducted)} so‘m`,
        {
          align: 'right',
        },
      );
    doc
      .fontSize(12)
      .text(
        `O‘tkaziladi: ${fmt(s.exportedTotal ?? Math.max(0, s.totalAmount - s.debtDeducted))} so‘m`,
        {
          align: 'right',
        },
      );
    doc.end();
    const pdf = await done;
    return {
      fileName: `akt-sverka_${s.number}_${s.periodEnd}.pdf`,
      contentType: 'application/pdf',
      base64: pdf.toString('base64'),
    };
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
        exportedTotal:
          r.exportedTotal === null ? null : moneyFromDb(r.exportedTotal),
        debtDeducted: moneyFromDb(r.debtDeducted),
        exportedAt: r.exportedAt,
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
