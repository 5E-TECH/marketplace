import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
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
const ID = /^\d{1,19}$/;
const LOCK = 'finance-elchi-check';
/** checkout ro‘yxati (5 000 tagacha posilka) uchun kutish. */
const PARCELS_TIMEOUT_MS = 60_000;
/** Bitta 100 talik so‘rov: elchi-integration Elchi’ni 70 s gacha kutadi — undan uzunroq. */
const BATCH_TIMEOUT_MS = 80_000;
const NOTIFY_TIMEOUT_MS = 5_000;
/** Xabardagi buyurtmalar soni (to‘liq ro‘yxat — moliya sahifasida) [taklif]. */
const ALERT_ORDERS = 20;
/** Tugamagan tekshiruv shuncha vaqtdan keyin «osilgan» hisoblanadi (qo‘lda qayta ishga tushirish mumkin). */
const STALE_RUN_MINUTES = 30;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

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
  state: 'DIFF' | 'FAILED';
  reasons: ElchiCheckReason[];
  order_status: LeadOrderStatus;
  elchi_status: string | null;
  cod_amount: string;
  elchi_collected: string | null;
  elchi_fee: string | null;
  elchi_market_paid: string | null;
  recorded_collected: string | null;
  recorded_fee: string | null;
  recorded_market_paid: string | null;
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

/** Yoziladigan qator (mos posilka yozilmaydi). */
interface NewItem {
  parcel: ElchiCheckParcel;
  state: 'DIFF' | 'FAILED';
  reasons: ElchiCheckReason[];
  elchiStatus: string | null;
  elchiCollected: number | null;
  elchiFee: number | null;
  elchiMarketPaid: number | null;
  recorded: RecordedRemittance | null;
  error: string | null;
  signature: string;
}

const RUN_COLUMNS = `id::text, to_char(check_date, 'YYYY-MM-DD') AS check_date, trigger, started_at, finished_at,
  checked, matched, diff_count, resolved_count, failed, truncated, error, alerted_at`;
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
 * tadan so‘raladi va har posilka holati va puli bizdagi bilan solishtiriladi (`compareElchiShipment`). Mos posilkalar
 * faqat sanaladi, farqlilari ro‘yxatda; moliya farqni izoh bilan yopadi, keyingi kun xuddi shu farq takrorlansa izoh
 * ko‘chadi. Yangi farq bo‘lsa — moliya va nazoratchiga xabar (TZ ELC-4 «farq bo‘lsa moliyaga ogohlantirish»).
 * Pul harakati yo‘q.
 */
@Injectable()
export class ElchiCheckService {
  private readonly logger = new Logger(ElchiCheckService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
    @Inject(RmqClient.CHECKOUT) private readonly checkout: ClientProxy,
    @Inject(RmqClient.INTEGRATION) private readonly integration: ClientProxy,
    @Inject(RmqClient.NOTIFICATION) private readonly notifications: ClientProxy,
  ) {}

  @Cron('0 0 10 * * *', { name: 'finance-elchi-check', timeZone: ZONE })
  async daily(): Promise<void> {
    if (this.config.get<string>('ELCHI_STATUS_CHECK') !== 'on') return;
    await runAsLeader(this.dataSource, LOCK, () => this.run('CRON', null));
  }

  /**
   * Qo‘lda ishga tushirish (moliya). Tekshiruv daqiqalar davom etishi mumkin — fonda ishlaydi, natija `get` da.
   * Boshqa tekshiruv ishlayotgan bo‘lsa — 409.
   */
  async start(input: { userId?: string }): Promise<{ accepted: true }> {
    const userId = String(input?.userId ?? '');
    if (!ID.test(userId)) throw new BadRequestException('userId noto‘g‘ri');
    if (await this.running())
      throw new ConflictException('Elchi tekshiruvi hozir ishlamoqda');
    void runAsLeader(this.dataSource, LOCK, () => this.run('MANUAL', userId))
      .then((leader) => {
        if (!leader.ran)
          this.logger.warn('Elchi tekshiruvi: boshqa nusxa ishlamoqda');
      })
      .catch((error) =>
        this.logger.error(
          `Elchi tekshiruvi yiqildi: ${(error as Error)?.message}`,
          (error as Error)?.stack,
        ),
      );
    return { accepted: true };
  }

  /** Bitta tekshiruv (qulf ichida chaqiriladi). Butunlay yiqilsa — xato tekshiruv qatorida. */
  async run(
    trigger: 'CRON' | 'MANUAL',
    userId: string | null,
  ): Promise<ElchiCheckRunDto> {
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
      const recorded = await this.recorded(parcels.map((p) => p.orderId));
      const items: NewItem[] = [];
      for (const parcel of parcels) {
        const item = this.itemOf(parcel, elchi, recorded.get(parcel.orderId));
        if (item) items.push(item);
      }
      const saved = await this.save(run.id, items);
      const failed = items.filter((item) => item.state === 'FAILED').length;
      const allFailed = parcels.length > 0 && failed === parcels.length;
      const [done] = returned<RunRow>(
        await this.dataSource.query(
          `UPDATE finance.elchi_check_run
            SET finished_at = now(), checked = $2, matched = $3, diff_count = $4, resolved_count = $5,
                failed = $6, truncated = $7, error = $8
          WHERE id = $1 RETURNING ${RUN_COLUMNS}`,
          [
            run.id,
            parcels.length,
            parcels.length - items.length,
            saved.open,
            saved.carried,
            failed,
            truncated,
            allFailed ? 'Elchi hech bir posilka holatini bermadi' : null,
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

  /** Kunning oxirgi tekshiruvi (bo‘sh — eng oxirgisi). */
  async get(input: { date?: string }): Promise<ElchiCheckRunDto> {
    const run = await this.findRun({ date: input?.date });
    if (!run) throw new NotFoundException('Elchi tekshiruvi hali bo‘lmagan');
    return this.toRun(run);
  }

  /** Tekshiruvdagi farqlar: ochiq farq birinchi, keyin yangisi. */
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
    const run = await this.findRun({ runId: q.runId, date: q.date });
    if (!run)
      return { run: null, items: [], total: 0, page, limit, totalPages: 0 };
    const search =
      q.search === undefined || q.search === null
        ? null
        : String(q.search).trim().slice(0, 64) || null;
    const where = `run_id = $1
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
   * Farqni izoh bilan yopish. Faqat posilkaning eng oxirgi tekshiruvdagi farqi — keyin qayta tekshirilgan bo‘lsa 409
   * (yangi ro‘yxatdan yopiladi).
   */
  async resolve(input: {
    id?: string;
    comment?: string;
    userId?: string;
  }): Promise<ElchiCheckItemDto> {
    const id = String(input?.id ?? '');
    if (!ID.test(id)) throw new BadRequestException('id noto‘g‘ri');
    const comment = String(input?.comment ?? '').trim();
    if (comment.length < 3 || comment.length > 1000)
      throw new BadRequestException('Izoh majburiy (3–1000 belgi)');
    const userId = String(input?.userId ?? '');
    if (!ID.test(userId)) throw new BadRequestException('userId noto‘g‘ri');

    const row = await this.dataSource.transaction(async (m) => {
      const [item] = (await m.query(
        `SELECT * FROM finance.elchi_check_item WHERE id = $1 FOR UPDATE`,
        [id],
      )) as ItemRow[];
      if (!item) throw new NotFoundException('Tekshiruv qatori topilmadi');
      if (item.state !== 'DIFF')
        throw new ConflictException('Bu qatorda farq yo‘q');
      if (item.resolved_at)
        throw new ConflictException('Farq allaqachon hal qilingan');
      const newer = (await m.query(
        `SELECT 1 FROM finance.elchi_check_item WHERE order_id = $1 AND run_id > $2 LIMIT 1`,
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

  private async running(): Promise<boolean> {
    const rows = (await this.dataSource.query(
      `SELECT 1 FROM finance.elchi_check_run
        WHERE finished_at IS NULL AND started_at > now() - make_interval(mins => $1) LIMIT 1`,
      [STALE_RUN_MINUTES],
    )) as unknown[];
    return rows.length > 0;
  }

  /** Elchi’dan 100 tadan, ketma-ket (partner API daqiqasiga 120 so‘rov). Bo‘lak yiqilsa — o‘sha posilkalar FAILED. */
  private async fetchElchi(parcels: ElchiCheckParcel[]): Promise<ElchiFetch> {
    const found = new Map<string, ElchiShipmentStatus>();
    const notFound = new Set<string>();
    const failed = new Map<string, string>();
    const ids = [...new Set(parcels.map((p) => p.shipmentId))];
    for (let i = 0; i < ids.length; i += ELCHI_STATUS_BATCH_MAX) {
      const chunk = ids.slice(i, i + ELCHI_STATUS_BATCH_MAX);
      try {
        const res = await this.call<ElchiShipmentsStatusResult>(
          this.integration,
          ELCHI_CHECK_RPC.SHIPMENTS_STATUS,
          { shipmentIds: chunk },
          BATCH_TIMEOUT_MS,
        );
        for (const item of res?.items ?? []) found.set(item.shipmentId, item);
        for (const id of res?.notFound ?? []) notFound.add(String(id));
        for (const row of res?.failed ?? [])
          failed.set(String(row.shipmentId), String(row.error ?? 'xato'));
      } catch (error) {
        const message = String((error as Error)?.message ?? error);
        for (const id of chunk) failed.set(id, message);
      }
    }
    return { found, notFound, failed };
  }

  /** Buyurtmalarning moliyadagi oxirgi Elchi o‘tkazmasi (rad to‘lovi qatorlari emas). */
  private async recorded(
    orderIds: string[],
  ): Promise<Map<string, RecordedRemittance>> {
    if (!orderIds.length) return new Map();
    const rows = (await this.dataSource.query(
      `SELECT DISTINCT ON (order_id) order_id AS "orderId",
              collected_from_customer::text AS collected, elchi_fee::text AS fee,
              market_paid_amount::text AS paid
         FROM finance.remittance_item
        WHERE order_id = ANY($1::text[]) AND refusal_fee IS NULL
        ORDER BY order_id, id DESC`,
      [orderIds],
    )) as Array<{
      orderId: string;
      collected: string | null;
      fee: string | null;
      paid: string | null;
    }>;
    return new Map(
      rows.map((r) => [
        r.orderId,
        {
          collectedFromCustomer: money(r.collected),
          elchiFee: money(r.fee),
          marketPaidAmount: money(r.paid),
        },
      ]),
    );
  }

  private itemOf(
    parcel: ElchiCheckParcel,
    elchi: ElchiFetch,
    recorded: RecordedRemittance | undefined,
  ): NewItem | null {
    const base = {
      parcel,
      recorded: recorded ?? null,
      elchiStatus: null,
      elchiCollected: null,
      elchiFee: null,
      elchiMarketPaid: null,
      error: null,
    };
    const shipment = elchi.found.get(parcel.shipmentId);
    if (shipment) {
      const result = compareElchiShipment(parcel, shipment, recorded ?? null);
      if (!result.reasons.length) return null;
      return this.withSignature({
        ...base,
        state: 'DIFF',
        reasons: result.reasons,
        elchiStatus: shipment.status,
        elchiCollected: result.elchiCollected,
        elchiFee: result.elchiFee,
        elchiMarketPaid: result.elchiMarketPaid,
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
    const r = item.recorded;
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
        r?.collectedFromCustomer ?? null,
        r?.elchiFee ?? null,
        r?.marketPaidAmount ?? null,
      ]),
    };
  }

  /**
   * Qatorlarni yozadi. Farq oldingi tekshiruvdagi oxirgi farq bilan bir xil bo‘lsa: u yopilgan bo‘lsa — izoh
   * ko‘chadi (yopiq qoladi), ochiq bo‘lsa — ochiq qoladi, lekin yangi emas (xabar takrorlanmaydi).
   */
  private async save(
    runId: string,
    items: NewItem[],
  ): Promise<{ open: number; carried: number; fresh: NewItem[] }> {
    if (!items.length) return { open: 0, carried: 0, fresh: [] };
    const diffs = items.filter((item) => item.state === 'DIFF');
    const previous = new Map(
      (diffs.length
        ? ((await this.dataSource.query(
            `SELECT DISTINCT ON (order_id) order_id AS "orderId", signature,
                    resolution_comment AS comment, resolved_by AS "by", resolved_at AS "at"
               FROM finance.elchi_check_item
              WHERE order_id = ANY($1::text[]) AND state = 'DIFF' AND run_id < $2
              ORDER BY order_id, id DESC`,
            [diffs.map((item) => item.parcel.orderId), runId],
          )) as Array<{
            orderId: string;
            signature: string;
            comment: string | null;
            by: string | null;
            at: Date | null;
          }>)
        : []
      ).map((row) => [row.orderId, row]),
    );
    let open = 0;
    let carried = 0;
    const fresh: NewItem[] = [];
    await this.dataSource.transaction(async (m) => {
      for (const item of items) {
        const prev = previous.get(item.parcel.orderId);
        const same =
          item.state === 'DIFF' && prev?.signature === item.signature;
        const carry = same && prev?.at ? prev : null;
        if (item.state === 'DIFF') {
          if (carry) carried += 1;
          else open += 1;
          if (!same) fresh.push(item);
        }
        const r = item.recorded;
        await m.query(
          `INSERT INTO finance.elchi_check_item
             (run_id, order_id, order_number, shipment_id, state, reasons, order_status, elchi_status, cod_amount,
              elchi_collected, elchi_fee, elchi_market_paid, recorded_collected, recorded_fee, recorded_market_paid,
              error, signature, resolution_comment, resolved_by, resolved_at, resolution_carried)
           VALUES ($1, $2, $3, $4, $5, $6::text[], $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)`,
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
            r?.collectedFromCustomer ?? null,
            r?.elchiFee ?? null,
            r?.marketPaidAmount ?? null,
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

  private async findRun(input: {
    runId?: string;
    date?: string;
  }): Promise<RunRow | null> {
    if (input.runId !== undefined && input.runId !== null) {
      const runId = String(input.runId);
      if (!ID.test(runId)) throw new BadRequestException('runId noto‘g‘ri');
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
      `SELECT ${RUN_COLUMNS} FROM finance.elchi_check_run
        WHERE ($1::date IS NULL OR check_date = $1::date)
        ORDER BY id DESC LIMIT 1`,
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
      recordedCollected: money(row.recorded_collected),
      recordedFee: money(row.recorded_fee),
      recordedMarketPaid: money(row.recorded_market_paid),
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
