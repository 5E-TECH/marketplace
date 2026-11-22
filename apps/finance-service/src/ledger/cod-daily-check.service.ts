import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { Cron } from '@nestjs/schedule';
import { firstValueFrom, timeout } from 'rxjs';
import { DataSource } from 'typeorm';
import {
  COD_RECONCILIATION_MISMATCH_EVENT,
  CodDailyCheckDto,
  CodDailyCheckMismatchDto,
  CodReconciliationMismatchEvent,
  moneyFromDb,
  RmqClient,
  runAsLeader,
} from '@app/common';

const ZONE = 'Asia/Tashkent';
const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Xabardagi buyurtmalar soni (to‘liq ro‘yxat — admin sahifasida) [taklif]. */
const ALERT_ORDERS = 20;
/** Xabar navbati ishlamasa kunlik ish (va leader qulfi) osilib qolmasin. */
const NOTIFY_TIMEOUT_MS = 5_000;

interface DailyRow {
  check_date: string;
  matched: number;
  partial: number;
  mismatch: number;
  pending: number;
  expected_total: string;
  received_total: string;
  mismatches: CodDailyCheckMismatchDto[];
  computed_at: Date;
  alerted_at: Date | null;
}

interface ItemRow {
  orderId: string;
  shipmentId: string | null;
  elchiStatus: string;
  state: 'PENDING' | 'MATCHED' | 'PARTIAL' | 'MISMATCH';
  expected: string | null;
  orderExpected: string | null;
  diff: string | null;
  paid: string | null;
  refusalFee: string | null;
}

/**
 * Kunlik COD sverkasi (BE-21; TZ ELC-4 «Kunlik sverka; farq bo‘lsa moliyaga ogohlantirish», TZ bildirishnomalar
 * jadvali «Sverka farqi» → nazoratchi va moliya).
 *
 * O‘sha kuni kelgan yoki holati o‘zgargan Elchi o‘tkazmalari (BE-22 `remittance_item`) buyurtma bo‘yicha: mos, qisman,
 * mos emas, kutilmoqda; kutilgan va kelgan jami. Mos emas bo‘lsa — moliya va nazoratchiga xabar (bir kun uchun bir
 * marta). Tolerans TZ da yo‘q — har qanday farq. BE-22 kechki tekshiruvi (03:00) o‘zgarmaydi.
 */
@Injectable()
export class CodDailyCheckService {
  private readonly logger = new Logger(CodDailyCheckService.name);

  constructor(
    private readonly dataSource: DataSource,
    @Inject(RmqClient.NOTIFICATION) private readonly notifications: ClientProxy,
  ) {}

  /** Har kuni 09:00 (Toshkent) [taklif] — kechagi kun uchun. */
  @Cron('0 0 9 * * *', { name: 'finance-cod-daily-check', timeZone: ZONE })
  async daily(): Promise<void> {
    await runAsLeader(this.dataSource, 'finance-cod-daily-check', () =>
      this.run({}),
    );
  }

  /** Hisoblaydi (qayta hisoblash ham — natija yangilanadi, xabar ikki marta ketmaydi). */
  async run(input: { date?: string }): Promise<CodDailyCheckDto> {
    const date = this.dateOf(input?.date);
    // kun chegarasi Toshkent vaqtida; indeksli oraliq (created_at, updated_at)
    const rows = (await this.dataSource.query(
      `WITH day AS (
         SELECT ($1::date)::timestamp AT TIME ZONE '${ZONE}' AS since,
                ($1::date + 1)::timestamp AT TIME ZONE '${ZONE}' AS until
       )
       SELECT DISTINCT ON (i.order_id)
              i.order_id AS "orderId", i.shipment_id AS "shipmentId", i.elchi_status AS "elchiStatus",
              i.match_state AS "state", i.expected_amount AS "expected", i.diff,
              i.market_paid_amount AS "paid", i.refusal_fee AS "refusalFee",
              (SELECT max(x.expected_amount) FROM finance.remittance_item x
                WHERE x.order_id = i.order_id) AS "orderExpected"
         FROM finance.remittance_item i, day
        WHERE (i.created_at >= day.since AND i.created_at < day.until)
           OR (i.updated_at >= day.since AND i.updated_at < day.until)
        ORDER BY i.order_id, i.id DESC`,
      [date],
    )) as ItemRow[];
    const count = (state: string) =>
      rows.filter((row) => row.state === state).length;
    let expectedTotal = 0;
    let receivedTotal = 0;
    const mismatches: CodDailyCheckMismatchDto[] = [];
    for (const row of rows) {
      const paid =
        row.refusalFee !== null
          ? moneyFromDb(row.refusalFee)
          : row.paid !== null
            ? moneyFromDb(row.paid)
            : null;
      let expected: number | null;
      let received: number;
      let diff: number;
      if (row.expected !== null) {
        expected = moneyFromDb(row.expected);
        received = paid ?? expected + moneyFromDb(row.diff ?? '0');
        diff = received - expected;
      } else {
        // hisob-kitobdan keyingi o‘tkazma: moliya farqni oldingi mos to‘lovga nisbatan yozadi (BE-22) — o‘sha farq
        diff = moneyFromDb(row.diff ?? '0');
        received = paid ?? 0;
        expected = row.orderExpected === null ? null : received - diff;
      }
      if (expected !== null && row.state !== 'PENDING') {
        expectedTotal += expected;
        receivedTotal += received;
      }
      if (row.state === 'MISMATCH')
        mismatches.push({
          orderId: row.orderId,
          shipmentId: row.shipmentId,
          elchiStatus: row.elchiStatus,
          expected: expected ?? 0,
          received,
          diff,
        });
    }
    const [saved] = (await this.dataSource.query(
      `INSERT INTO finance.cod_daily_check
         (check_date, matched, partial, mismatch, pending, expected_total, received_total, mismatches, computed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, now())
       ON CONFLICT (check_date) DO UPDATE SET
         matched = EXCLUDED.matched, partial = EXCLUDED.partial, mismatch = EXCLUDED.mismatch,
         pending = EXCLUDED.pending, expected_total = EXCLUDED.expected_total,
         received_total = EXCLUDED.received_total, mismatches = EXCLUDED.mismatches, computed_at = now()
       RETURNING to_char(check_date, 'YYYY-MM-DD') AS check_date, matched, partial, mismatch, pending,
                 expected_total, received_total, mismatches, computed_at, alerted_at`,
      [
        date,
        count('MATCHED'),
        count('PARTIAL'),
        mismatches.length,
        count('PENDING'),
        expectedTotal,
        receivedTotal,
        JSON.stringify(mismatches),
      ],
    )) as DailyRow[];
    if (mismatches.length && !saved.alerted_at)
      saved.alerted_at = await this.alert(date, mismatches);
    return this.toDto(saved);
  }

  async get(input: { date?: string }): Promise<CodDailyCheckDto> {
    const date = this.dateOf(input?.date);
    const [row] = (await this.dataSource.query(
      `SELECT to_char(check_date, 'YYYY-MM-DD') AS check_date, matched, partial, mismatch, pending,
              expected_total, received_total, mismatches, computed_at, alerted_at
         FROM finance.cod_daily_check WHERE check_date = $1::date`,
      [date],
    )) as DailyRow[];
    if (!row) throw new NotFoundException('Bu kun uchun sverka hali yo‘q');
    return this.toDto(row);
  }

  /**
   * Moliya va nazoratchiga xabar. Avval kun «xabar berildi» deb band qilinadi (ikki parallel hisoblash ikki xabar
   * yubormasin); yuborilmasa — bo‘shatiladi va keyingi hisoblashda qayta urinadi.
   */
  private async alert(
    date: string,
    mismatches: CodDailyCheckMismatchDto[],
  ): Promise<Date | null> {
    const claimed = this.rows<{ alerted_at: Date }>(
      await this.dataSource.query(
        `UPDATE finance.cod_daily_check SET alerted_at = now()
          WHERE check_date = $1::date AND alerted_at IS NULL RETURNING alerted_at`,
        [date],
      ),
    );
    if (!claimed.length) return this.alertedAt(date); // boshqasi yubordi
    const event: CodReconciliationMismatchEvent = {
      date,
      mismatchCount: mismatches.length,
      diffTotal: mismatches.reduce((sum, item) => sum + item.diff, 0),
      orders: mismatches.slice(0, ALERT_ORDERS).map((item) => ({
        orderId: item.orderId,
        expected: item.expected,
        received: item.received,
        diff: item.diff,
      })),
    };
    try {
      await firstValueFrom(
        this.notifications
          .emit(COD_RECONCILIATION_MISMATCH_EVENT, event)
          .pipe(timeout(NOTIFY_TIMEOUT_MS)),
        { defaultValue: undefined },
      );
    } catch (error) {
      this.logger.error(
        `Sverka farqi (${date}) xabari yuborilmadi: ${(error as Error)?.message}`,
      );
      await this.dataSource.query(
        `UPDATE finance.cod_daily_check SET alerted_at = NULL WHERE check_date = $1::date`,
        [date],
      );
      return null;
    }
    this.logger.warn(
      `Sverka farqi (${date}): ${event.mismatchCount} buyurtma, farq ${event.diffTotal}`,
    );
    return claimed[0].alerted_at;
  }

  private async alertedAt(date: string): Promise<Date | null> {
    const [row] = (await this.dataSource.query(
      'SELECT alerted_at FROM finance.cod_daily_check WHERE check_date = $1::date',
      [date],
    )) as Array<{ alerted_at: Date | null }>;
    return row?.alerted_at ?? null;
  }

  /** TypeORM UPDATE … RETURNING uchun [qatorlar, soni] qaytaradi. */
  private rows<T>(result: unknown): T[] {
    const list = result as unknown[];
    return (Array.isArray(list?.[0]) ? list[0] : list) as T[];
  }

  /** Sana (Toshkent); bo‘sh — kecha. */
  private dateOf(value: string | undefined): string {
    if (value === undefined || value === null || value === '')
      return new Date(Date.now() - 24 * 60 * 60 * 1000).toLocaleDateString(
        'sv-SE',
        { timeZone: ZONE },
      );
    const date = String(value);
    const parsed = new Date(`${date}T00:00:00Z`);
    if (
      !DATE.test(date) ||
      Number.isNaN(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== date
    )
      throw new BadRequestException('Sana YYYY-MM-DD bo‘lishi kerak');
    return date;
  }

  private toDto(row: DailyRow): CodDailyCheckDto {
    return {
      date: row.check_date,
      matched: Number(row.matched),
      partial: Number(row.partial),
      mismatch: Number(row.mismatch),
      pending: Number(row.pending),
      expectedTotal: moneyFromDb(row.expected_total),
      receivedTotal: moneyFromDb(row.received_total),
      mismatches: row.mismatches ?? [],
      computedAt: row.computed_at,
      alertedAt: row.alerted_at,
    };
  }
}
