import { Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import {
  FinanceRemittanceEvent,
  LeadOrderStatus,
  OrderReturnedEvent,
  OrderStatusChangedEvent,
  moneyFromDb,
  processOnce,
  returningRows,
} from '@app/common';
import {
  AccountType,
  LineKind,
  SplitError,
  orderTotals,
  splitDelivered,
} from './split';

/** Hisob qulfi kalit sinfi [taklif]: 2101/2102 (lead), 2201 (cron), 6303 (payment) band. */
const ACCOUNT_LOCK_CLASS = 2301;
/** Buyurtma qulfi kalit sinfi [taklif]: bir buyurtma hodisalari ketma-ket. */
const ORDER_LOCK_CLASS = 2302;

export type JournalKind =
  | 'ORDER_DELIVERED'
  | 'ORDER_REFUSED'
  | 'ORDER_REVERSAL'
  | 'ELCHI_SETTLEMENT'
  | 'WITHDRAWAL_PAID'
  | 'WHOLESALER_PAID';

export interface Line {
  account: AccountType;
  ownerId: string;
  lineKind: LineKind;
  itemSeq: number;
  productId: string | null;
  quantity?: number | null;
  amount: number;
}

export interface JournalHead {
  kind: JournalKind;
  referenceId: string;
  /** Pul yechish (WITHDRAWAL_PAID) jurnalida buyurtma yo‘q — null (BE-23). */
  orderId: string | null;
  /** Hodisasiz jurnal (pul yechish) uchun sotuvchi — journal.affiliate_id (soliq hisoboti, T01:471). */
  affiliateId?: string | null;
  eventId: string;
  occurredAt: string;
  gross: number;
  event?: OrderStatusChangedEvent;
  reversesJournalId?: string | null;
}

export type RemittanceMatch = 'PENDING' | 'MATCHED' | 'PARTIAL' | 'MISMATCH';

/**
 * BE-22: ko'p tomonli hisoblar va taqsimot (TZ 6.8 MOL-1…MOL-4).
 *
 * - `order.status.changed` DELIVERED → ORDER_DELIVERED jurnali, hamma qator
 *   HOLD (2.5-3, MOL-2). REFUSED → platformaga −rad to'lovi, Elchi ga + (MOL-3).
 * - `finance.cod.settled` v2 (Elchi o'tkazmasi) → buyurtma yozuvlari
 *   HOLD → AVAILABLE va sverka (MOL-2, ELC-4).
 * - `order.returned` → asl yozuvlar REVERSED + teskari (ko'zgu) yozuvlar
 *   (2.5-4, MOL-4); mavjud balans manfiy bo'lishi mumkin va keyingi daromaddan
 *   qoplanadi.
 *
 * Takror: hodisa `processOnce` bilan (eventId), biznes fakti jurnal
 * (kind, reference_id) unikalligi bilan — Elchi bir holatni yangi eventId
 * bilan qayta yuborsa ham taqsimot bir marta (TC5). Balans keshi hisob
 * qulfi ostida o'zgaradi; qulflar hisob ID si bo'yicha tartiblangan.
 *
 * Xato hodisa (noto'g'ri summa, yetishmagan maydon) `event_failure` ga
 * yoziladi: RMQ hozir noAck (BE-02 gacha), tashlangan xato hodisani yo'qotardi.
 */
@Injectable()
export class LedgerService {
  private readonly logger = new Logger(LedgerService.name);

  constructor(private readonly dataSource: DataSource) {}

  // ---------------------------------------------------------------- hodisalar

  async onOrderStatusChanged(event: OrderStatusChangedEvent): Promise<void> {
    if (
      event?.status !== LeadOrderStatus.DELIVERED &&
      event?.status !== LeadOrderStatus.REFUSED
    ) {
      return; // boshqa holatlar pul yozmaydi (pul faqat to'langan buyurtma uchun, 01:20)
    }
    await this.guard('finance.order-status', event, (manager) =>
      event.status === LeadOrderStatus.DELIVERED
        ? this.recordDelivered(manager, event)
        : this.recordRefused(manager, event),
    );
  }

  async onRemittance(event: FinanceRemittanceEvent): Promise<void> {
    await this.guard('finance.remittance', event, (manager) =>
      this.recordRemittance(manager, event),
    );
  }

  async onOrderReturned(event: OrderReturnedEvent): Promise<void> {
    await this.guard('finance.order-returned', event, (manager) =>
      this.recordReturn(manager, event),
    );
  }

  /**
   * Hodisani bir marta ishlaydi; kutilgan xato (SplitError) — event_failure
   * qatori, hodisa belgisi yoziladi (qayta urinish foydasiz). Kutilmagan xato
   * ham event_failure ga tushadi, lekin belgi rollback bo'ladi.
   */
  private async guard(
    consumer: string,
    event: { eventId?: string; orderId?: string },
    handle: (manager: EntityManager) => Promise<void>,
  ): Promise<void> {
    if (!event?.eventId) {
      await this.failure(consumer, null, 'eventId yo‘q', event);
      return;
    }
    try {
      await processOnce(
        this.dataSource,
        { table: 'finance.processed_event', consumer, eventId: event.eventId },
        async (manager) => {
          // Bir buyurtma hodisalari (yetkazildi, o'tkazma, qaytarish) ketma-ket:
          // ikki ulanishda bir vaqtda kelsa bir-birini o'tkazib yubormaydi.
          if (event.orderId) {
            await manager.query(
              'SELECT pg_advisory_xact_lock($1, hashtext($2))',
              [ORDER_LOCK_CLASS, `finance-order:${String(event.orderId)}`],
            );
          }
          await handle(manager);
        },
      );
    } catch (error) {
      // Xato bo'lsa belgi ham qaytadi: tuzatilgan hodisa o'sha eventId bilan
      // qayta yuborilsa ishlanadi; takror yozuvdan jurnal unikalligi saqlaydi.
      await this.failure(
        consumer,
        event.eventId,
        (error as Error).message,
        event,
      );
      if (!(error instanceof SplitError)) {
        this.logger.error(
          `${consumer} ${event.eventId}: ${(error as Error).message}`,
        );
      }
    }
  }

  private async failure(
    consumer: string,
    eventId: string | null,
    reason: string,
    payload: unknown,
    manager: EntityManager = this.dataSource.manager,
  ): Promise<void> {
    this.logger.warn(`${consumer} ${eventId ?? '-'}: ${reason}`);
    await manager.query(
      `INSERT INTO finance.event_failure (consumer, event_id, reason, payload)
       VALUES ($1, $2, $3, $4::jsonb)`,
      [consumer, eventId, reason, JSON.stringify(payload ?? null)],
    );
  }

  // --------------------------------------------------------------- yetkazildi

  private async recordDelivered(
    manager: EntityManager,
    event: OrderStatusChangedEvent,
  ): Promise<void> {
    const lines = splitDelivered(event); // SplitError → event_failure
    const { gross } = orderTotals(event);
    const journalId = await this.writeJournal(
      manager,
      {
        kind: 'ORDER_DELIVERED',
        referenceId: String(event.orderId),
        orderId: String(event.orderId),
        eventId: event.eventId,
        occurredAt: event.occurredAt,
        gross,
        event,
      },
      lines,
      'HOLD',
    );
    if (!journalId) return; // takroriy fakt (TC5)
    // Elchi o'tkazmasi «yetkazildi» dan oldin kelgan bo'lishi mumkin.
    await this.applyRemittance(manager, String(event.orderId));
  }

  // -------------------------------------------------------------------- rad

  private async recordRefused(
    manager: EntityManager,
    event: OrderStatusChangedEvent,
  ): Promise<void> {
    const fee = await this.refusalFee(manager, event.occurredAt);
    if (fee === 0) return; // sozlama 0 — rad uchun yozuv yo'q
    const journalId = await this.writeJournal(
      manager,
      {
        kind: 'ORDER_REFUSED',
        referenceId: String(event.orderId),
        orderId: String(event.orderId),
        eventId: event.eventId,
        occurredAt: event.occurredAt,
        gross: fee,
        event,
      },
      [
        // Faqat platforma: sotuvchi, optovik va qo'ng'iroq markazi yozuvi yo'q (TC3).
        {
          account: 'PLATFORM_SERVICE',
          ownerId: '',
          lineKind: 'REFUSAL_FEE',
          itemSeq: 0,
          productId: null,
          amount: -fee,
        },
        {
          account: 'ELCHI',
          ownerId: '',
          lineKind: 'REFUSAL_FEE',
          itemSeq: 0,
          productId: null,
          amount: fee,
        },
      ],
      'HOLD',
    );
    if (journalId) await this.applyRemittance(manager, String(event.orderId));
  }

  /** Rad to'lovi — hodisa vaqtida amaldagi sozlama (seed 20 000: 6-qaror, MOL-3). */
  private async refusalFee(
    manager: EntityManager,
    at: string,
  ): Promise<number> {
    const [row] = (await manager.query(
      `SELECT value FROM finance.setting
        WHERE key = 'refusal_fee' AND effective_from <= $1::timestamptz
        ORDER BY effective_from DESC LIMIT 1`,
      [at],
    )) as Array<{ value: string }>;
    if (!row) throw new SplitError('refusal_fee sozlamasi yo‘q');
    return moneyFromDb(row.value);
  }

  // --------------------------------------------------------- Elchi o'tkazmasi

  private async recordRemittance(
    manager: EntityManager,
    event: FinanceRemittanceEvent,
  ): Promise<void> {
    for (const [field, value] of [
      ['collectedFromCustomer', event.collectedFromCustomer],
      ['elchiFee', event.elchiFee],
      ['marketPaidAmount', event.marketPaidAmount],
    ] as const) {
      if (!Number.isSafeInteger(value) || value < 0) {
        throw new SplitError(
          `${field}: butun so‘m bo‘lishi kerak (${String(value)})`,
        );
      }
    }
    if (!event.orderId) throw new SplitError('orderId yo‘q');
    const [remittance] = (await manager.query(
      `INSERT INTO finance.elchi_remittance (event_id, payload)
       VALUES ($1, $2::jsonb)
       ON CONFLICT (event_id) DO NOTHING
       RETURNING id::text`,
      [event.eventId, JSON.stringify(event)],
    )) as Array<{ id: string }>;
    if (!remittance) return;
    await manager.query(
      `INSERT INTO finance.remittance_item
         (remittance_id, order_id, shipment_id, elchi_status, collected_from_customer,
          elchi_fee, market_paid_amount, refusal_fee, match_state)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'PENDING')`,
      [
        remittance.id,
        String(event.orderId),
        event.shipmentId ?? null,
        event.elchiStatus,
        event.collectedFromCustomer,
        event.elchiFee,
        event.marketPaidAmount,
        event.refusalFee ?? null,
      ],
    );
    await this.applyRemittance(manager, String(event.orderId));
  }

  /**
   * Buyurtma bo'yicha o'tkazmani yozuvlarga qo'llaydi (yetkazildi yoki rad
   * jurnali bor bo'lsa). Kutilgan summa: sotuv − yashirilgan yetkazish (Elchi
   * o'z tarifini, shu jumladan yashirilgan qismni, ushlab qoladi). To'liq
   * to'langan (`paid`, jami ≥ kutilgan) — HOLD → AVAILABLE va
   * ELCHI_SETTLEMENT; qisman — PARTIAL; kam — MISMATCH (yozuvlar HOLD qoladi).
   */
  private async applyRemittance(
    manager: EntityManager,
    orderId: string,
  ): Promise<RemittanceMatch | null> {
    const items = (await manager.query(
      `SELECT id::text, elchi_status AS "status", market_paid_amount AS "paid",
              refusal_fee AS "refusalFee", match_state AS "match"
         FROM finance.remittance_item WHERE order_id = $1 ORDER BY id`,
      [orderId],
    )) as Array<{
      id: string;
      status: string;
      paid: string | null;
      refusalFee: string | null;
      match: RemittanceMatch;
    }>;
    if (!items.length) return null;
    const journals = (await manager.query(
      `SELECT id::text, kind, gross_amount AS "gross" FROM finance.journal
        WHERE order_id = $1 AND kind IN ('ORDER_DELIVERED','ORDER_REFUSED','ELCHI_SETTLEMENT')`,
      [orderId],
    )) as Array<{ id: string; kind: JournalKind; gross: string }>;
    const delivered = journals.find((j) => j.kind === 'ORDER_DELIVERED');
    const refused = journals.find((j) => j.kind === 'ORDER_REFUSED');
    if (!delivered && !refused) return 'PENDING'; // hodisa keyin keladi
    if (items.some((i) => i.match === 'MATCHED')) {
      // Buyurtma allaqachon hisob-kitob qilingan. Elchi holatni yangi
      // eventId bilan qayta yuborishi mumkin: o'sha ma'lumotli takror —
      // MATCHED (o'zgarish yo'q); boshqacha summa — MISMATCH (ortiqcha to'lov).
      const matched = items.filter((i) => i.match === 'MATCHED');
      const topPaid = Math.max(...matched.map((m) => moneyFromDb(m.paid)));
      for (const item of items.filter((i) => i.match !== 'MATCHED')) {
        // Takror yoki eskirgan snapshot (to'langan jami hisob-kitobdagidan oshmaydi).
        const duplicate =
          item.refusalFee !== null
            ? matched.some((m) => m.refusalFee === item.refusalFee)
            : moneyFromDb(item.paid) <= topPaid;
        if (!duplicate) {
          this.logger.warn(
            `Buyurtma ${orderId}: hisob-kitobdan keyin yana o‘tkazma keldi (${item.status}, ${item.paid ?? item.refusalFee})`,
          );
        }
        await manager.query(
          `UPDATE finance.remittance_item
              SET match_state = $2, diff = $3, updated_at = now()
            WHERE id = $1`,
          [
            item.id,
            duplicate ? 'MATCHED' : 'MISMATCH',
            duplicate
              ? 0
              : item.refusalFee !== null
                ? moneyFromDb(item.refusalFee)
                : moneyFromDb(item.paid) - topPaid,
          ],
        );
      }
      return 'MATCHED';
    }

    let match: RemittanceMatch;
    let expected: number;
    let received: number;
    const settle: Line[] = [];
    if (delivered) {
      const hidden = await this.sumLines(
        manager,
        delivered.id,
        'HIDDEN_DELIVERY',
      );
      expected = moneyFromDb(delivered.gross) - hidden;
      // Elchi `market_paid_amount` — shu paytgacha to'langan JAMI (snapshot):
      // qo'shilmaydi, oxirgi holat olinadi (takror yuborish yoki partly_paid →
      // paid kam to'lovni yashirmasin).
      const payments = items.filter(
        (i) => i.status === 'paid' || i.status === 'partly_paid',
      );
      const latest = payments[payments.length - 1];
      received = latest ? moneyFromDb(latest.paid) : 0;
      match = !latest
        ? 'PENDING'
        : latest.status === 'paid'
          ? received >= expected
            ? 'MATCHED'
            : 'MISMATCH'
          : 'PARTIAL';
      if (hidden) {
        // Elchi yashirilgan yetkazishni o'z haqi ichida oldi: qarzimiz yopildi.
        settle.push(
          {
            account: 'ELCHI',
            ownerId: '',
            lineKind: 'ELCHI_KEPT',
            itemSeq: 0,
            productId: null,
            amount: -hidden,
          },
          {
            account: 'COD_CLEARING',
            ownerId: '',
            lineKind: 'ELCHI_KEPT',
            itemSeq: 0,
            productId: null,
            amount: hidden,
          },
        );
      }
    } else {
      // Rad: Elchi to'lovni boshqa puldan ushlaydi; summa sozlamaga teng bo'lishi kerak.
      const fee = await this.sumLines(
        manager,
        refused!.id,
        'REFUSAL_FEE',
        'ELCHI',
      );
      const charged = [...items].reverse().find((i) => i.refusalFee !== null);
      expected = fee;
      received = charged ? moneyFromDb(charged.refusalFee) : 0;
      match = !charged ? 'PENDING' : received === fee ? 'MATCHED' : 'MISMATCH';
      if (match === 'MATCHED') {
        settle.push(
          {
            account: 'ELCHI',
            ownerId: '',
            lineKind: 'REFUSAL_FEE',
            itemSeq: 0,
            productId: null,
            amount: -fee,
          },
          {
            account: 'COD_CLEARING',
            ownerId: '',
            lineKind: 'REFUSAL_FEE',
            itemSeq: 0,
            productId: null,
            amount: fee,
          },
        );
      }
    }
    await manager.query(
      `UPDATE finance.remittance_item
          SET match_state = $2, expected_amount = $3, diff = $4, updated_at = now()
        WHERE order_id = $1`,
      [orderId, match, expected, received - expected],
    );
    if (match !== 'MATCHED') {
      if (match === 'MISMATCH') {
        this.logger.warn(
          `Buyurtma ${orderId}: Elchi o‘tkazmasi mos emas (kutilgan ${expected}, kelgan ${received})`,
        );
      }
      return match;
    }
    const sourceJournal = (delivered ?? refused)!;
    await this.makeAvailable(manager, sourceJournal.id);
    if (settle.length) {
      await this.writeJournal(
        manager,
        {
          kind: 'ELCHI_SETTLEMENT',
          referenceId: orderId,
          orderId,
          eventId: `settlement:${orderId}`,
          occurredAt: new Date().toISOString(),
          gross: Math.abs(settle[0].amount),
        },
        settle,
        'AVAILABLE',
      );
    }
    return match;
  }

  private async sumLines(
    manager: EntityManager,
    journalId: string,
    lineKind: LineKind,
    account?: AccountType,
  ): Promise<number> {
    const [row] = (await manager.query(
      `SELECT COALESCE(SUM(e.amount), 0) AS total
         FROM finance.ledger_entry e JOIN finance.account a ON a.id = e.account_id
        WHERE e.journal_id = $1 AND e.line_kind = $2 AND ($3::text IS NULL OR a.type = $3)`,
      [journalId, lineKind, account ?? null],
    )) as Array<{ total: string }>;
    return moneyFromDb(row.total);
  }

  /** Jurnalning HOLD yozuvlari → AVAILABLE; balans keshi qulf ostida. */
  private async makeAvailable(
    manager: EntityManager,
    journalId: string,
  ): Promise<void> {
    const entries = (await manager.query(
      `SELECT id::text, account_id::text AS "accountId", amount
         FROM finance.ledger_entry WHERE journal_id = $1 AND state = 'HOLD'`,
      [journalId],
    )) as Array<{ id: string; accountId: string; amount: string }>;
    if (!entries.length) return;
    await this.lockAccounts(
      manager,
      entries.map((e) => e.accountId),
    );
    // UPDATE … RETURNING → [qatorlar, soni] (TypeORM): returningRows.
    const moved = returningRows<{ accountId: string; amount: string }>(
      await manager.query(
        `UPDATE finance.ledger_entry SET state = 'AVAILABLE', available_at = now()
        WHERE journal_id = $1 AND state = 'HOLD'
        RETURNING account_id::text AS "accountId", amount`,
        [journalId],
      ),
    );
    for (const [accountId, delta] of this.byAccount(moved)) {
      await manager.query(
        `UPDATE finance.account
            SET hold_balance = hold_balance - $2, available_balance = available_balance + $2
          WHERE id = $1`,
        [accountId, delta],
      );
    }
  }

  // ---------------------------------------------------------------- qaytarish

  /**
   * To'liq qaytarish: yetkazildi jurnalining har yozuvi (HOLD yoki AVAILABLE)
   * REVERSED bo'ladi va ORDER_REVERSAL jurnalida ko'zgu (−summa) yozuv paydo
   * bo'ladi (dizayn: «5 asl + 5 teskari»). Mavjud balans manfiy bo'lishi
   * mumkin — keyingi daromad uni qoplaydi (MOL-4). Qisman qaytarish hozircha
   * yozilmaydi — event_failure (egaga savol) [taklif].
   */
  private async recordReturn(
    manager: EntityManager,
    event: OrderReturnedEvent,
  ): Promise<void> {
    if (!event.orderId || !event.returnRequestId) {
      throw new SplitError('orderId yoki returnRequestId yo‘q');
    }
    const [delivered] = (await manager.query(
      `SELECT id::text, gross_amount AS "gross", lead_id AS "leadId", stream_id AS "streamId",
              affiliate_id AS "affiliateId", source, order_number AS "orderNumber"
         FROM finance.journal WHERE kind = 'ORDER_DELIVERED' AND reference_id = $1`,
      [String(event.orderId)],
    )) as Array<{ id: string; gross: string }>;
    if (!delivered)
      throw new SplitError('yetkazildi yozuvi yo‘q — qaytarib bo‘lmaydi');
    const [open] = (await manager.query(
      `SELECT count(*)::int AS n FROM finance.ledger_entry
        WHERE journal_id = $1 AND state IN ('HOLD','AVAILABLE')`,
      [delivered.id],
    )) as Array<{ n: number }>;
    if (!open.n) throw new SplitError('buyurtma allaqachon qaytarilgan');
    // To'liq qaytarishmi: har tovar bo'yicha qaytgan soni yetkazilgan soniga teng.
    const lines = (await manager.query(
      `SELECT DISTINCT item_seq AS "seq", product_id AS "productId", quantity
         FROM finance.ledger_entry
        WHERE journal_id = $1 AND product_id IS NOT NULL AND reverses_entry_id IS NULL`,
      [delivered.id],
    )) as Array<{ seq: number; productId: string; quantity: number | null }>;
    const deliveredQty = new Map<string, number>();
    for (const l of lines) {
      deliveredQty.set(
        l.productId,
        (deliveredQty.get(l.productId) ?? 0) + Number(l.quantity ?? 0),
      );
    }
    const returnedQty = new Map<string, number>();
    for (const i of event.items ?? []) {
      const q = Number(i.quantity);
      if (!Number.isSafeInteger(q) || q < 1)
        throw new SplitError(`qaytgan soni noto‘g‘ri: ${String(i.quantity)}`);
      returnedQty.set(
        String(i.productId),
        (returnedQty.get(String(i.productId)) ?? 0) + q,
      );
    }
    const full =
      returnedQty.size === deliveredQty.size &&
      [...deliveredQty].every(([p, q]) => returnedQty.get(p) === q);
    if (!full) {
      throw new SplitError(
        'qisman qaytarish hozircha yozilmaydi (egaga savol)',
      );
    }
    const [journal] = (await manager.query(
      `INSERT INTO finance.journal
         (kind, reference_id, order_id, gross_amount, event_id, reverses_journal_id, occurred_at)
       VALUES ('ORDER_REVERSAL', $1, $2, $3, $4, $5, $6)
       ON CONFLICT (kind, reference_id) DO NOTHING
       RETURNING id::text`,
      [
        String(event.returnRequestId),
        String(event.orderId),
        moneyFromDb(delivered.gross),
        event.eventId,
        delivered.id,
        event.occurredAt,
      ],
    )) as Array<{ id: string }>;
    if (!journal) return;
    const entries = (await manager.query(
      `SELECT id::text, account_id::text AS "accountId" FROM finance.ledger_entry
        WHERE journal_id = $1 AND state IN ('HOLD','AVAILABLE')`,
      [delivered.id],
    )) as Array<{ id: string; accountId: string }>;
    await this.lockAccounts(
      manager,
      entries.map((e) => e.accountId),
    );
    const flipped = returningRows<{
      id: string;
      accountId: string;
      amount: string;
      lineKind: LineKind;
      itemSeq: number;
      productId: string | null;
      oldState: 'HOLD' | 'AVAILABLE';
    }>(
      await manager.query(
        `UPDATE finance.ledger_entry e SET state = 'REVERSED', reversed_at = now()
         FROM (SELECT id, state AS old_state FROM finance.ledger_entry
                WHERE journal_id = $1 AND state IN ('HOLD','AVAILABLE') FOR UPDATE) o
        WHERE e.id = o.id
        RETURNING e.id::text, e.account_id::text AS "accountId", e.amount,
                  e.line_kind AS "lineKind", e.item_seq AS "itemSeq",
                  e.product_id AS "productId", o.old_state AS "oldState"`,
        [delivered.id],
      ),
    );
    for (const e of flipped) {
      const amount = moneyFromDb(e.amount);
      await manager.query(
        `INSERT INTO finance.ledger_entry
           (journal_id, account_id, line_kind, item_seq, product_id, amount, state, reverses_entry_id, reversed_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'REVERSED', $7, now())`,
        [
          journal.id,
          e.accountId,
          e.lineKind,
          e.itemSeq,
          e.productId,
          -amount,
          e.id,
        ],
      );
      await manager.query(
        e.oldState === 'HOLD'
          ? `UPDATE finance.account SET hold_balance = hold_balance - $2 WHERE id = $1`
          : `UPDATE finance.account SET available_balance = available_balance - $2 WHERE id = $1`,
        [e.accountId, amount],
      );
    }
  }

  // ------------------------------------------------------------ umumiy yozish

  /**
   * Jurnal va yozuvlar; jurnal (kind, reference_id) allaqachon bo'lsa — null
   * (takror). Hisoblar yaratiladi, ID bo'yicha tartiblab qulflanadi, balans
   * keshi o'zgaradi.
   */
  async writeJournal(
    manager: EntityManager,
    head: JournalHead,
    lines: Line[],
    state: 'HOLD' | 'AVAILABLE',
  ): Promise<string | null> {
    const sum = lines.reduce((s, l) => s + l.amount, 0);
    if (sum !== 0) throw new Error(`Jurnal muvozanatda emas: ${sum}`);
    const e = head.event;
    const [journal] = (await manager.query(
      `INSERT INTO finance.journal
         (kind, reference_id, order_id, order_number, lead_id, stream_id, affiliate_id, source,
          gross_amount, event_id, reverses_journal_id, occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (kind, reference_id) DO NOTHING
       RETURNING id::text`,
      [
        head.kind,
        head.referenceId,
        head.orderId,
        e?.orderNumber ?? null,
        e?.leadId ?? null,
        e?.streamId ?? null,
        e?.affiliateId ?? head.affiliateId ?? null,
        e?.source ?? null,
        head.gross,
        head.eventId,
        head.reversesJournalId ?? null,
        head.occurredAt,
      ],
    )) as Array<{ id: string }>;
    if (!journal) return null;
    const accountIds = new Map<string, string>();
    for (const line of lines) {
      const key = `${line.account}|${line.ownerId}`;
      if (!accountIds.has(key)) {
        accountIds.set(
          key,
          await this.accountId(manager, line.account, line.ownerId),
        );
      }
    }
    await this.lockAccounts(manager, [...accountIds.values()]);
    const deltas = new Map<string, number>();
    for (const line of lines) {
      const accountId = accountIds.get(`${line.account}|${line.ownerId}`)!;
      await manager.query(
        `INSERT INTO finance.ledger_entry
           (journal_id, account_id, line_kind, item_seq, product_id, quantity, amount, state, available_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, ${state === 'AVAILABLE' ? 'now()' : 'NULL'})`,
        [
          journal.id,
          accountId,
          line.lineKind,
          line.itemSeq,
          line.productId,
          line.quantity ?? null,
          line.amount,
          state,
        ],
      );
      deltas.set(accountId, (deltas.get(accountId) ?? 0) + line.amount);
    }
    const column = state === 'HOLD' ? 'hold_balance' : 'available_balance';
    for (const [accountId, delta] of deltas) {
      await manager.query(
        `UPDATE finance.account SET ${column} = ${column} + $2 WHERE id = $1`,
        [accountId, delta],
      );
    }
    return journal.id;
  }

  async accountId(
    manager: EntityManager,
    type: AccountType,
    ownerId: string,
  ): Promise<string> {
    await manager.query(
      `INSERT INTO finance.account (type, owner_id) VALUES ($1, $2)
       ON CONFLICT (type, owner_id) DO NOTHING`,
      [type, ownerId],
    );
    const [row] = (await manager.query(
      `SELECT id::text FROM finance.account WHERE type = $1 AND owner_id = $2`,
      [type, ownerId],
    )) as Array<{ id: string }>;
    return row.id;
  }

  /** Hisob qulflari ID bo'yicha o'sish tartibida — o'zaro kutish (deadlock) yo'q. */
  async lockAccounts(manager: EntityManager, ids: string[]): Promise<void> {
    const sorted = [...new Set(ids)].sort((a, b) => Number(a) - Number(b));
    for (const id of sorted) {
      await manager.query('SELECT pg_advisory_xact_lock($1, hashtext($2))', [
        ACCOUNT_LOCK_CLASS,
        `finance-account:${id}`,
      ]);
    }
  }

  private byAccount(
    rows: Array<{ accountId: string; amount: string }>,
  ): Map<string, number> {
    const out = new Map<string, number>();
    for (const r of rows)
      out.set(r.accountId, (out.get(r.accountId) ?? 0) + moneyFromDb(r.amount));
    return out;
  }
}
