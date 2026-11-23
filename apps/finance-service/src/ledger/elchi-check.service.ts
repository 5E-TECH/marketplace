import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientProxy } from '@nestjs/microservices';
import { Cron } from '@nestjs/schedule';
import { firstValueFrom, timeout } from 'rxjs';
import { DataSource } from 'typeorm';
import {
  ELCHI_CHECK_MISMATCH_EVENT,
  ELCHI_CHECK_RPC,
  ELCHI_STATUS_BATCH_MAX,
  ElchiCheckItemDto,
  ElchiCheckItemPageDto,
  ElchiCheckItemsQueryDto,
  ElchiCheckItemState,
  ElchiCheckMismatchEvent,
  ElchiCheckParcel,
  ElchiCheckParcelsResult,
  ElchiCheckReason,
  ElchiCheckRunDto,
  ElchiShipmentsStatusResult,
  ElchiShipmentStatus,
  LEADER_LOCK_CLASS,
  LeadOrderStatus,
  moneyFromDb,
  RmqClient,
  runAsLeader,
} from '@app/common';
import {
  compareElchiShipment,
  RecordedRemittance,
} from './elchi-check.compare';
import { validDay } from './remittance.service';

const ZONE = 'Asia/Tashkent';
const ID = /^[1-9]\d{0,18}$/;
const MAX_BIGINT = BigInt('9223372036854775807');
/** `runAsLeader` qulfining nomi — kunlik ish va qo‘lda ishga tushirish bir qulf bilan. */
const LOCK = 'finance-elchi-check';
/** checkout ro‘yxati (5 000 tagacha posilka) uchun kutish. */
const PARCELS_TIMEOUT_MS = 60_000;
/** Bitta 100 talik so‘rov: elchi-integration Elchi’ni 70 s gacha kutadi — undan uzunroq. */
const BATCH_TIMEOUT_MS = 80_000;
/** Ketma-ket shuncha bo‘lak o‘qilmasa — Elchi ishlamayapti, qolgani so‘ralmaydi (tekshiruv soatlab cho‘zilmasin). */
const MAX_FAILED_BATCHES = 3;
const NOTIFY_TIMEOUT_MS = 5_000;
/** Xabardagi buyurtmalar soni (to‘liq ro‘yxat — moliya sahifasida) [taklif]. */
const ALERT_ORDERS = 20;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const STOPPED = 'Elchi javob bermadi — tekshiruv to‘xtatildi';

interface RunRow {
  id: string;
  check_date: string;
  trigger: 'CRON' | 'MANUAL';
  started_at: Date;
  finished_at: Date | null;
  checked: number;
  matched: number;
  diff_count: number;
  resolved_count: number;
  failed: number;
  truncated: boolean;
  error: string | null;
  alerted_at: Date | null;
}

interface ItemRow {
  id: string;
  run_id: string;
  order_id: string;
  order_number: string;
  shipment_id: string;
  state: 'DIFF' | 'FAILED' | 'MATCHED';
  reasons: ElchiCheckReason[];
  order_status: LeadOrderStatus;
  elchi_status: string | null;
  cod_amount: string;
  elchi_collected: string | null;
  elchi_fee: string | null;
  elchi_market_paid: string | null;
  elchi_extra_cost: string | null;
  recorded_collected: string | null;
  recorded_fee: string | null;
  recorded_market_paid: string | null;
  recorded_refusal_fee: string | null;
  error: string | null;
  resolution_comment: string | null;
  resolved_by: string | null;
  resolved_at: Date | null;
  resolution_carried: boolean;
  created_at: Date;
}

/** Elchi javobi: topilgan, topilmagan, o‘qib bo‘lmagan posilkalar. */
interface ElchiFetch {
  found: Map<string, ElchiShipmentStatus>;
  notFound: Set<string>;
  failed: Map<string, string>;
}

/** Moliyadagi yozuvlar: o‘tkazma (to‘langani eng katta qator) va rad to‘lovi. */
interface Recorded {
  payment: RecordedRemittance | null;
  refusalFee: number | null;
}

/** Yoziladigan qator: farq, o‘qib bo‘lmagan yoki «farq yo‘qoldi» belgisi (mos posilkalar yozilmaydi). */
interface NewItem {
  parcel: ElchiCheckParcel;
  state: 'DIFF' | 'FAILED' | 'MATCHED';
  reasons: ElchiCheckReason[];
  elchiStatus: string | null;
  elchiCollected: number | null;
  elchiFee: number | null;
  elchiMarketPaid: number | null;
  elchiExtraCost: number | null;
  recorded: Recorded;
  error: string | null;
  signature: string;
}

const RUN_COLUMNS = `id::text, to_char(check_date, 'YYYY-MM-DD') AS check_date, trigger, started_at, finished_at,
  checked, matched, diff_count, resolved_count, failed, truncated, error, alerted_at`;
const NOTHING: Recorded = { payment: null, refusalFee: null };
const money = (v: string | null) => (v === null ? null : moneyFromDb(v));
/** TypeORM `UPDATE … RETURNING` natijasi `[qatorlar, soni]` — qatorlarni ajratadi (BE-21 `cod-daily-check` dagi kabi). */
function returned<T>(result: unknown): T[] {
  const list = result as unknown[];
  return (Array.isArray(list?.[0]) ? list[0] : list) as T[];
}

/**
 * BE-46 TC3 (ega qarori 2026-11-24, «Avtomatik so‘rov»): Elchi bilan kunlik avtomatik tekshiruv.
 *
 * Har kuni 10:00 (Toshkent) [taklif — BE-21 kunlik COD sverkasi 09:00 dan keyin] `ELCHI_STATUS_CHECK=on` bo‘lsa;
 * moliya qo‘lda ham ishga tushiradi. Elchi’ga topshirilgan lid posilkalari (checkout) Elchi partner API sidan 100
 * tadan so‘raladi va har posilka holati va puli bizdagi bilan solishtiriladi (`compareElchiShipment`); farq chiqqanlari
 * Elchi javobidan keyin bizda qayta o‘qiladi (tekshiruv davomida kelgan xabar soxta farq bermasin). Mos posilkalar
 * faqat sanaladi, farqlilari ro‘yxatda; moliya farqni izoh bilan yopadi. Keyingi tekshiruvda xuddi shu farq oldingi
 * natijaning davomi bo‘lsa — izoh ko‘chadi va xabar takrorlanmaydi; farq yo‘qolib qaytsa — yangi farq. Yangi farq
 * bo‘lsa — moliya va nazoratchiga xabar (TZ ELC-4 «farq bo‘lsa moliyaga ogohlantirish»). Pul harakati yo‘q.
 */
@Injectable()
export class ElchiCheckService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ElchiCheckService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
    @Inject(RmqClient.CHECKOUT) private readonly checkout: ClientProxy,
    @Inject(RmqClient.INTEGRATION) private readonly integration: ClientProxy,
    @Inject(RmqClient.NOTIFICATION) private readonly notifications: ClientProxy,
  ) {}

  /** Jarayon tekshiruv o‘rtasida to‘xtagan bo‘lsa — o‘sha tekshiruv «ishlamoqda» bo‘lib qolmasin. */
  onApplicationBootstrap(): void {
    void runAsLeader(this.dataSource, LOCK, () => this.closeOrphans()).catch(
      (error) =>
        this.logger.warn(
          `Uzilgan Elchi tekshiruvlari yopilmadi: ${(error as Error)?.message}`,
        ),
    );
  }

  @Cron('0 0 10 * * *', { name: 'finance-elchi-check', timeZone: ZONE })
  async daily(): Promise<void> {
    if (this.config.get<string>('ELCHI_STATUS_CHECK') !== 'on') return;
    await runAsLeader(this.dataSource, LOCK, () => this.run('CRON', null));
  }

  /**
   * Qo‘lda ishga tushirish (moliya). Qulf shu yerda olinadi — boshqa tekshiruv ishlayotgan bo‘lsa darhol 409; tekshiruv
   * daqiqalar davom etishi mumkin — fonda ishlaydi (qulf tugaguncha ushlanadi), natija `get` da.
   */
  async start(input: { userId?: string }): Promise<{ accepted: true }> {
    const userId = this.id(input?.userId, 'userId');
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    let handedOff = false;
    try {
      await runner.startTransaction();
      // `runAsLeader` bilan bir xil qulf (LEADER_LOCK_CLASS, hashtext(nom)) — kunlik ish bilan bir vaqtda bo‘lmaydi
      const [row] = (await runner.query(
        'SELECT pg_try_advisory_xact_lock($1, hashtext($2)) AS locked',
        [LEADER_LOCK_CLASS, LOCK],
      )) as Array<{ locked: boolean }>;
      if (!row?.locked)
        throw new ConflictException('Elchi tekshiruvi hozir ishlamoqda');
      handedOff = true;
      void this.run('MANUAL', userId)
        .catch((error) =>
          this.logger.error(
            `Elchi tekshiruvi yiqildi: ${(error as Error)?.message}`,
            (error as Error)?.stack,
          ),
        )
        .finally(() => this.release(runner));
      return { accepted: true };
    } finally {
      if (!handedOff) await this.release(runner);
    }
  }

  /** Bitta tekshiruv (qulf ichida chaqiriladi). Butunlay yiqilsa — xato tekshiruv qatorida. */
  async run(
    trigger: 'CRON' | 'MANUAL',
    userId: string | null,
  ): Promise<ElchiCheckRunDto> {
    await this.closeOrphans();
    const [run] = (await this.dataSource.query(
      `INSERT INTO finance.elchi_check_run (check_date, trigger, triggered_by)
       VALUES ((now() AT TIME ZONE '${ZONE}')::date, $1, $2) RETURNING ${RUN_COLUMNS}`,
      [trigger, userId],
    )) as RunRow[];
    try {
      const { parcels, truncated } = await this.call<ElchiCheckParcelsResult>(
        this.checkout,
        ELCHI_CHECK_RPC.PARCELS,
        {},
        PARCELS_TIMEOUT_MS,
      );
      if (truncated)
        this.logger.warn(
          `Elchi tekshiruvi: posilkalar chegaradan ko‘p — ${parcels.length} tasi tekshirildi`,
        );
      const elchi = await this.fetchElchi(parcels);
      const items = await this.compare(parcels, elchi);
      const saved = await this.save(run.id, items, parcels, elchi);
      const written = items.filter((item) => item.state !== 'MATCHED');
      const failed = written.filter((item) => item.state === 'FAILED').length;
      const allFailed = parcels.length > 0 && failed === parcels.length;
      const stopped = [...elchi.failed.values()].includes(STOPPED);
      const [done] = returned<RunRow>(
        await this.dataSource.query(
          `UPDATE finance.elchi_check_run
              SET finished_at = now(), checked = $2, matched = $3, diff_count = $4, resolved_count = $5,
                  failed = $6, truncated = $7, error = $8
            WHERE id = $1 RETURNING ${RUN_COLUMNS}`,
          [
            run.id,
            parcels.length,
            parcels.length - written.length,
            saved.open,
            saved.carried,
            failed,
            truncated,
            allFailed
              ? 'Elchi hech bir posilka holatini bermadi'
              : stopped
                ? STOPPED
                : null,
          ],
        ),
      );
      if (saved.fresh.length)
        done.alerted_at = await this.alert(done, saved.fresh, saved.open);
      return this.toRun(done);
    } catch (error) {
      const message = String((error as Error)?.message ?? error).slice(0, 1000);
      this.logger.error(`Elchi tekshiruvi bajarilmadi: ${message}`);
      const [failedRun] = returned<RunRow>(
        await this.dataSource.query(
          `UPDATE finance.elchi_check_run SET finished_at = now(), error = $2
            WHERE id = $1 RETURNING ${RUN_COLUMNS}`,
          [run.id, message],
        ),
      );
      return this.toRun(failedRun);
    }
  }

  /** Kunning oxirgi tekshiruvi (bo‘sh — eng oxirgisi; ishlayotgan yoki yiqilgani ham — holatini ko‘rsatish uchun). */
  async get(input: { date?: string }): Promise<ElchiCheckRunDto> {
    const run = await this.findRun({ date: input?.date });
    if (!run) throw new NotFoundException('Elchi tekshiruvi hali bo‘lmagan');
    return this.toRun(run);
  }

  /**
   * Tekshiruvdagi farqlar: ochiq farq birinchi, keyin yangisi. `runId` siz — oxirgi tugagan va yiqilmagan tekshiruv
   * (ishlayotgan yoki yiqilgan tekshiruv oldingi ochiq farqlarni yashirmasin).
   */
  async items(input: {
    query?: ElchiCheckItemsQueryDto;
  }): Promise<ElchiCheckItemPageDto> {
    const q = input?.query ?? {};
    const page = Math.max(1, Math.trunc(Number(q.page)) || 1);
    const limit = Math.min(
      MAX_LIMIT,
      Math.max(1, Math.trunc(Number(q.limit)) || DEFAULT_LIMIT),
    );
    const offset = (page - 1) * limit;
    if (!Number.isSafeInteger(offset))
      throw new BadRequestException('page juda katta');
    if (
      q.state !== undefined &&
      !Object.values(ElchiCheckItemState).includes(q.state)
    )
      throw new BadRequestException('state noto‘g‘ri');
    const run = await this.findRun({
      runId: q.runId,
      date: q.date,
      completed: true,
    });
    if (!run)
      return { run: null, items: [], total: 0, page, limit, totalPages: 0 };
    const search =
      q.search === undefined || q.search === null
        ? null
        : String(q.search).trim().slice(0, 64) || null;
    const where = `run_id = $1 AND state <> 'MATCHED'
       AND ($2::text IS NULL
            OR ($2 = 'FAILED' AND state = 'FAILED')
            OR ($2 = 'DIFF' AND state = 'DIFF' AND resolved_at IS NULL)
            OR ($2 = 'RESOLVED' AND resolved_at IS NOT NULL))
       AND ($3::text IS NULL OR order_id = $3 OR order_number = $3 OR shipment_id = $3)`;
    const params = [run.id, q.state ?? null, search];
    const [{ total }] = (await this.dataSource.query(
      `SELECT COUNT(*)::int AS total FROM finance.elchi_check_item WHERE ${where}`,
      params,
    )) as Array<{ total: number }>;
    const rows = (await this.dataSource.query(
      `SELECT * FROM finance.elchi_check_item WHERE ${where}
        ORDER BY (state = 'DIFF' AND resolved_at IS NULL) DESC, id DESC
        LIMIT ${limit} OFFSET ${offset}`,
      params,
    )) as ItemRow[];
    return {
      run: this.toRun(run),
      items: rows.map((row) => this.toItem(row)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Farqni izoh bilan yopish. Posilka keyin qayta tekshirilib yana farq chiqqan bo‘lsa — 409 (yangi ro‘yxatdan
   * yopiladi); keyingi tekshiruvda o‘qib bo‘lmagan (FAILED) yoki farq yo‘qolgan bo‘lsa — yopish mumkin.
   */
  async resolve(input: {
    id?: string;
    comment?: string;
    userId?: string;
  }): Promise<ElchiCheckItemDto> {
    const id = this.id(input?.id, 'id');
    const comment = String(input?.comment ?? '').trim();
    if (comment.length < 3 || comment.length > 1000)
      throw new BadRequestException('Izoh majburiy (3–1000 belgi)');
    const userId = this.id(input?.userId, 'userId');

    const row = await this.dataSource.transaction(async (m) => {
      const [item] = (await m.query(
        `SELECT * FROM finance.elchi_check_item WHERE id = $1 FOR UPDATE`,
        [id],
      )) as ItemRow[];
      if (!item || item.state === 'MATCHED')
        throw new NotFoundException('Tekshiruv qatori topilmadi');
      if (item.state !== 'DIFF')
        throw new ConflictException('Bu qatorda farq yo‘q');
      if (item.resolved_at)
        throw new ConflictException('Farq allaqachon hal qilingan');
      const newer = (await m.query(
        `SELECT 1 FROM finance.elchi_check_item
          WHERE order_id = $1 AND run_id > $2 AND state = 'DIFF' LIMIT 1`,
        [item.order_id, item.run_id],
      )) as unknown[];
      if (newer.length)
        throw new ConflictException(
          'Posilka qayta tekshirilgan — farqni oxirgi tekshiruv ro‘yxatidan yoping',
        );
      const [updated] = returned<ItemRow>(
        await m.query(
          `UPDATE finance.elchi_check_item
              SET resolution_comment = $2, resolved_by = $3, resolved_at = now(), resolution_carried = false
            WHERE id = $1 RETURNING *`,
          [id, comment, userId],
        ),
      );
      await m.query(
        `UPDATE finance.elchi_check_run
            SET diff_count = GREATEST(diff_count - 1, 0), resolved_count = resolved_count + 1
          WHERE id = $1`,
        [item.run_id],
      );
      return updated;
    });
    return this.toItem(row);
  }

  // ------------------------------------------------------------------ ichki

  private id(value: unknown, field: string): string {
    const id = String(value ?? '');
    if (!ID.test(id) || BigInt(id) > MAX_BIGINT)
      throw new BadRequestException(`${field} noto‘g‘ri`);
    return id;
  }

  private async release(runner: ReturnType<DataSource['createQueryRunner']>) {
    if (runner.isTransactionActive)
      await runner.rollbackTransaction().catch(() => undefined);
    await runner.release();
  }

  /** Qulf ichida: hech bir tekshiruv ishlamayapti — tugamagan qatorlar uzilgan jarayondan qolgan. */
  private async closeOrphans(): Promise<void> {
    await this.dataSource.query(
      `UPDATE finance.elchi_check_run
          SET finished_at = now(), error = 'Tekshiruv uzildi (servis to‘xtagan)'
        WHERE finished_at IS NULL`,
    );
  }

  /**
   * Elchi’dan 100 tadan, ketma-ket (partner API daqiqasiga 120 so‘rov). Bo‘lak yiqilsa — o‘sha posilkalar FAILED;
   * ketma-ket 3 bo‘lak o‘qilmasa — qolganlari so‘ralmaydi (FAILED, «to‘xtatildi»).
   */
  private async fetchElchi(parcels: ElchiCheckParcel[]): Promise<ElchiFetch> {
    const found = new Map<string, ElchiShipmentStatus>();
    const notFound = new Set<string>();
    const failed = new Map<string, string>();
    const ids = [...new Set(parcels.map((p) => p.shipmentId))];
    let failedInRow = 0;
    for (let i = 0; i < ids.length; i += ELCHI_STATUS_BATCH_MAX) {
      const chunk = ids.slice(i, i + ELCHI_STATUS_BATCH_MAX);
      if (failedInRow >= MAX_FAILED_BATCHES) {
        for (const id of chunk) failed.set(id, STOPPED);
        continue;
      }
      try {
        const res = await this.call<ElchiShipmentsStatusResult>(
          this.integration,
          ELCHI_CHECK_RPC.SHIPMENTS_STATUS,
          { shipmentIds: chunk },
          BATCH_TIMEOUT_MS,
        );
        for (const item of res?.items ?? []) found.set(item.shipmentId, item);
        for (const id of res?.notFound ?? []) notFound.add(String(id));
        const chunkFailed = res?.failed ?? [];
        for (const row of chunkFailed)
          failed.set(String(row.shipmentId), String(row.error ?? 'xato'));
        failedInRow =
          !(res?.items ?? []).length &&
          !(res?.notFound ?? []).length &&
          chunkFailed.length
            ? failedInRow + 1
            : 0;
      } catch (error) {
        const message = String((error as Error)?.message ?? error);
        for (const id of chunk) failed.set(id, message);
        failedInRow += 1;
      }
    }
    return { found, notFound, failed };
  }

  /**
   * Solishtirish. Farq chiqqan posilkalar bizda qayta o‘qiladi (holat va moliya yozuvi Elchi javobidan keyin) — Elchi
   * xabari tekshiruv davomida kelgan bo‘lsa farq yo‘qoladi; qayta o‘qishda tekshiruvdan chiqqan posilka yozilmaydi.
   */
  private async compare(
    parcels: ElchiCheckParcel[],
    elchi: ElchiFetch,
  ): Promise<NewItem[]> {
    const recorded = await this.recorded(parcels.map((p) => p.orderId));
    const first = parcels
      .map((p) => this.itemOf(p, elchi, recorded.get(p.orderId) ?? NOTHING))
      .filter((item): item is NewItem => item !== null);
    const diffs = first.filter((item) => item.state === 'DIFF');
    if (!diffs.length) return first;
    const fresh = await this.call<ElchiCheckParcelsResult>(
      this.checkout,
      ELCHI_CHECK_RPC.PARCELS,
      { orderIds: diffs.map((item) => item.parcel.orderId) },
      PARCELS_TIMEOUT_MS,
    );
    const now = new Map(fresh.parcels.map((p) => [p.orderId, p]));
    const again = await this.recorded([...now.keys()]);
    const rechecked = diffs
      .map((item) => now.get(item.parcel.orderId))
      .filter((p): p is ElchiCheckParcel => p !== undefined)
      .map((p) => this.itemOf(p, elchi, again.get(p.orderId) ?? NOTHING))
      .filter((item): item is NewItem => item !== null);
    return [...first.filter((item) => item.state !== 'DIFF'), ...rechecked];
  }

  /**
   * Buyurtmalarning moliyadagi Elchi yozuvlari: o‘tkazma — to‘langan jami eng katta qator (ledger `applyRemittance`
   * kabi: kech kelgan eskirgan snapshot hisobga olinmaydi); rad to‘lovi — oxirgi rad to‘lovi qatori.
   */
  private async recorded(orderIds: string[]): Promise<Map<string, Recorded>> {
    if (!orderIds.length) return new Map();
    const payments = (await this.dataSource.query(
      `SELECT DISTINCT ON (order_id) order_id AS "orderId",
              collected_from_customer::text AS collected, elchi_fee::text AS fee,
              market_paid_amount::text AS paid
         FROM finance.remittance_item
        WHERE order_id = ANY($1::text[]) AND refusal_fee IS NULL
          AND elchi_status IN ('paid', 'partly_paid')
        ORDER BY order_id, market_paid_amount DESC NULLS LAST, id DESC`,
      [orderIds],
    )) as Array<{
      orderId: string;
      collected: string | null;
      fee: string | null;
      paid: string | null;
    }>;
    const refusals = (await this.dataSource.query(
      `SELECT DISTINCT ON (order_id) order_id AS "orderId", refusal_fee::text AS fee
         FROM finance.remittance_item
        WHERE order_id = ANY($1::text[]) AND refusal_fee IS NOT NULL
        ORDER BY order_id, id DESC`,
      [orderIds],
    )) as Array<{ orderId: string; fee: string }>;
    const result = new Map<string, Recorded>();
    for (const r of payments)
      result.set(r.orderId, {
        payment: {
          collectedFromCustomer: money(r.collected),
          elchiFee: money(r.fee),
          marketPaidAmount: money(r.paid),
        },
        refusalFee: null,
      });
    for (const r of refusals)
      result.set(r.orderId, {
        payment: result.get(r.orderId)?.payment ?? null,
        refusalFee: moneyFromDb(r.fee),
      });
    return result;
  }

  private itemOf(
    parcel: ElchiCheckParcel,
    elchi: ElchiFetch,
    recorded: Recorded,
  ): NewItem | null {
    const base = {
      parcel,
      recorded,
      elchiStatus: null,
      elchiCollected: null,
      elchiFee: null,
      elchiMarketPaid: null,
      elchiExtraCost: null,
      error: null,
    };
    const shipment = elchi.found.get(parcel.shipmentId);
    if (shipment) {
      const result = compareElchiShipment(
        parcel,
        shipment,
        recorded.payment,
        recorded.refusalFee,
      );
      if (!result.reasons.length) return null;
      return this.withSignature({
        ...base,
        state: 'DIFF',
        reasons: result.reasons,
        elchiStatus: shipment.status,
        elchiCollected: result.elchiCollected,
        elchiFee: result.elchiFee,
        elchiMarketPaid: result.elchiMarketPaid,
        elchiExtraCost: result.elchiExtraCost,
      });
    }
    if (elchi.notFound.has(parcel.shipmentId))
      return this.withSignature({
        ...base,
        state: 'DIFF',
        reasons: [ElchiCheckReason.NOT_FOUND],
      });
    return this.withSignature({
      ...base,
      state: 'FAILED',
      reasons: [],
      error: (
        elchi.failed.get(parcel.shipmentId) ?? 'Elchi javobida posilka yo‘q'
      ).slice(0, 500),
    });
  }

  /** Farqning o‘zi — sabablar, holatlar, summalar (vaqt va ID siz): o‘zgarmagan farq bir xil imzo beradi. */
  private withSignature(item: Omit<NewItem, 'signature'>): NewItem {
    const p = item.recorded.payment;
    return {
      ...item,
      signature: JSON.stringify([
        item.state,
        item.reasons,
        item.parcel.status,
        item.elchiStatus,
        item.parcel.codAmount,
        item.elchiCollected,
        item.elchiFee,
        item.elchiMarketPaid,
        item.elchiExtraCost,
        p?.collectedFromCustomer ?? null,
        p?.elchiFee ?? null,
        p?.marketPaidAmount ?? null,
        item.recorded.refusalFee,
      ]),
    };
  }

  /**
   * Qatorlarni yozadi. Posilkaning oxirgi ma’lum natijasi (oldingi tekshiruvlardagi farq yoki «farq yo‘qoldi»
   * belgisi; o‘qib bo‘lmagan kunlar hisobga olinmaydi) xuddi shu farq bo‘lsa — davomi: u yopilgan bo‘lsa izoh ko‘chadi,
   * ochiq bo‘lsa ochiq qoladi, lekin yangi emas (xabar takrorlanmaydi). Avval farqi bo‘lgan posilka endi mos bo‘lsa —
   * MATCHED belgisi (keyin xuddi shu farq qaytsa, u yangi farq).
   */
  private async save(
    runId: string,
    items: NewItem[],
    parcels: ElchiCheckParcel[],
    elchi: ElchiFetch,
  ): Promise<{ open: number; carried: number; fresh: NewItem[] }> {
    const byOrder = new Set(items.map((item) => item.parcel.orderId));
    const matchedParcels = parcels.filter((p) => !byOrder.has(p.orderId));
    const lookup = [
      ...items
        .filter((item) => item.state === 'DIFF')
        .map((i) => i.parcel.orderId),
      ...matchedParcels.map((p) => p.orderId),
    ];
    const previous = new Map(
      (lookup.length
        ? ((await this.dataSource.query(
            `SELECT DISTINCT ON (order_id) order_id AS "orderId", state, signature,
                    resolution_comment AS comment, resolved_by AS "by", resolved_at AS "at"
               FROM finance.elchi_check_item
              WHERE order_id = ANY($1::text[]) AND state IN ('DIFF', 'MATCHED') AND run_id < $2
              ORDER BY order_id, id DESC`,
            [lookup, runId],
          )) as Array<{
            orderId: string;
            state: 'DIFF' | 'MATCHED';
            signature: string;
            comment: string | null;
            by: string | null;
            at: Date | null;
          }>)
        : []
      ).map((row) => [row.orderId, row]),
    );
    // farqi bo‘lgan posilka endi mos — belgi (mos posilka qayta qo‘shilsa, `items` faqat shu yerda o‘zgaradi)
    const markers: NewItem[] = matchedParcels
      .filter((p) => previous.get(p.orderId)?.state === 'DIFF')
      .map((p) => ({
        parcel: p,
        state: 'MATCHED',
        reasons: [],
        elchiStatus: elchi.found.get(p.shipmentId)?.status ?? null,
        elchiCollected: null,
        elchiFee: null,
        elchiMarketPaid: null,
        elchiExtraCost: null,
        recorded: NOTHING,
        error: null,
        signature: '',
      }));
    const rows = [...items, ...markers];
    let open = 0;
    let carried = 0;
    const fresh: NewItem[] = [];
    if (!rows.length) return { open, carried, fresh };
    await this.dataSource.transaction(async (m) => {
      for (const item of rows) {
        const prev = previous.get(item.parcel.orderId);
        const same =
          item.state === 'DIFF' &&
          prev?.state === 'DIFF' &&
          prev.signature === item.signature;
        const carry = same && prev?.at ? prev : null;
        if (item.state === 'DIFF') {
          if (carry) carried += 1;
          else open += 1;
          if (!same) fresh.push(item);
        }
        const p = item.recorded.payment;
        await m.query(
          `INSERT INTO finance.elchi_check_item
             (run_id, order_id, order_number, shipment_id, state, reasons, order_status, elchi_status, cod_amount,
              elchi_collected, elchi_fee, elchi_market_paid, elchi_extra_cost, recorded_collected, recorded_fee,
              recorded_market_paid, recorded_refusal_fee, error, signature, resolution_comment, resolved_by,
              resolved_at, resolution_carried)
           VALUES ($1, $2, $3, $4, $5, $6::text[], $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19,
                   $20, $21, $22, $23)`,
          [
            runId,
            item.parcel.orderId,
            item.parcel.orderNumber,
            item.parcel.shipmentId,
            item.state,
            item.reasons,
            item.parcel.status,
            item.elchiStatus,
            item.parcel.codAmount,
            item.elchiCollected,
            item.elchiFee,
            item.elchiMarketPaid,
            item.elchiExtraCost,
            p?.collectedFromCustomer ?? null,
            p?.elchiFee ?? null,
            p?.marketPaidAmount ?? null,
            item.recorded.refusalFee,
            item.error,
            item.signature,
            carry?.comment ?? null,
            carry?.by ?? null,
            carry?.at ?? null,
            Boolean(carry),
          ],
        );
      }
    });
    return { open, carried, fresh };
  }

  /** Moliya va nazoratchiga xabar — faqat yangi farqlar bo‘lsa. Yuborilmasa — log (keyingi tekshiruv yangi emas). */
  private async alert(
    run: RunRow,
    fresh: NewItem[],
    open: number,
  ): Promise<Date | null> {
    const event: ElchiCheckMismatchEvent = {
      date: run.check_date,
      runId: run.id,
      newDiffCount: fresh.length,
      openDiffCount: open,
      orders: fresh.slice(0, ALERT_ORDERS).map((item) => ({
        orderId: item.parcel.orderId,
        orderNumber: item.parcel.orderNumber,
        reasons: item.reasons,
      })),
    };
    try {
      await firstValueFrom(
        this.notifications
          .emit(ELCHI_CHECK_MISMATCH_EVENT, event)
          .pipe(timeout(NOTIFY_TIMEOUT_MS)),
        { defaultValue: undefined },
      );
    } catch (error) {
      this.logger.error(
        `Elchi tekshiruvi (${run.check_date}) xabari yuborilmadi: ${(error as Error)?.message}`,
      );
      return null;
    }
    const [row] = returned<{ alerted_at: Date }>(
      await this.dataSource.query(
        `UPDATE finance.elchi_check_run SET alerted_at = now() WHERE id = $1 RETURNING alerted_at`,
        [run.id],
      ),
    );
    this.logger.warn(
      `Elchi tekshiruvi (${run.check_date}): yangi farq ${fresh.length}, ochiq ${open}`,
    );
    return row?.alerted_at ?? null;
  }

  /**
   * Tekshiruvni topadi: `runId` — aniq; aks holda kunning (bo‘sh — umuman) oxirgisi. `completed` — avval tugagan va
   * yiqilmagan tekshiruv (bo‘lmasa — oxirgisi).
   */
  private async findRun(input: {
    runId?: string;
    date?: string;
    completed?: boolean;
  }): Promise<RunRow | null> {
    if (input.runId !== undefined && input.runId !== null) {
      const runId = this.id(input.runId, 'runId');
      const [row] = (await this.dataSource.query(
        `SELECT ${RUN_COLUMNS} FROM finance.elchi_check_run WHERE id = $1`,
        [runId],
      )) as RunRow[];
      if (!row) throw new NotFoundException('Tekshiruv topilmadi');
      return row;
    }
    const date =
      input.date === undefined || input.date === null || input.date === ''
        ? null
        : validDay(input.date, 'date');
    const [row] = (await this.dataSource.query(
      // `RUN_COLUMNS` da `id::text AS id` — saralash jadval ustuni (bigint) bo‘yicha, matn bo‘yicha emas («9» > «12»)
      `SELECT ${RUN_COLUMNS} FROM finance.elchi_check_run r
        WHERE ($1::date IS NULL OR r.check_date = $1::date)
        ORDER BY ${input.completed ? '(r.finished_at IS NOT NULL AND r.error IS NULL) DESC, ' : ''}r.id DESC
        LIMIT 1`,
      [date],
    )) as RunRow[];
    return row ?? null;
  }

  private async call<T>(
    client: ClientProxy,
    cmd: string,
    data: unknown,
    ms: number,
  ): Promise<T> {
    return firstValueFrom(client.send<T>({ cmd }, data).pipe(timeout(ms)));
  }

  private toRun(row: RunRow): ElchiCheckRunDto {
    return {
      id: String(row.id),
      date: row.check_date,
      trigger: row.trigger,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      checked: Number(row.checked),
      matched: Number(row.matched),
      diffCount: Number(row.diff_count),
      resolvedCount: Number(row.resolved_count),
      failed: Number(row.failed),
      truncated: Boolean(row.truncated),
      error: row.error,
      alertedAt: row.alerted_at,
    };
  }

  private toItem(row: ItemRow): ElchiCheckItemDto {
    const state =
      row.state === 'FAILED'
        ? ElchiCheckItemState.FAILED
        : row.resolved_at
          ? ElchiCheckItemState.RESOLVED
          : ElchiCheckItemState.DIFF;
    return {
      id: String(row.id),
      runId: String(row.run_id),
      orderId: row.order_id,
      orderNumber: row.order_number,
      shipmentId: row.shipment_id,
      state,
      reasons: row.reasons ?? [],
      orderStatus: row.order_status,
      elchiStatus: row.elchi_status,
      codAmount: moneyFromDb(row.cod_amount),
      elchiCollected: money(row.elchi_collected),
      elchiFee: money(row.elchi_fee),
      elchiMarketPaid: money(row.elchi_market_paid),
      elchiExtraCost: money(row.elchi_extra_cost),
      recordedCollected: money(row.recorded_collected),
      recordedFee: money(row.recorded_fee),
      recordedMarketPaid: money(row.recorded_market_paid),
      recordedRefusalFee: money(row.recorded_refusal_fee),
      error: row.error,
      resolution: row.resolved_at
        ? {
            comment: row.resolution_comment ?? '',
            by: row.resolved_by ?? '',
            at: row.resolved_at,
            carried: Boolean(row.resolution_carried),
          }
        : null,
      checkedAt: row.created_at,
    };
  }
}
