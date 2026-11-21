import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { Cron } from '@nestjs/schedule';
import { firstValueFrom } from 'rxjs';
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

/**
 * Kunlik COD sverkasi (BE-21; TZ ELC-4 «Kunlik sverka; farq bo‘lsa moliyaga ogohlantirish», TZ bildirishnomalar
 * jadvali «Sverka farqi» → nazoratchi va moliya).
 *
 * O‘sha kuni kelgan Elchi o‘tkazmalari (BE-22 `remittance_item`) buyurtma bo‘yicha: mos, qisman, mos emas, kutilmoqda;
 * kutilgan va kelgan jami. Mos emas bo‘lsa — moliya va nazoratchiga xabar (bir kun uchun bir marta). Tolerans TZ da
 * yo‘q — har qanday farq. BE-22 kechki tekshiruvi (03:00) o‘zgarmaydi.
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
    const rows = (await this.dataSource.query(
      `SELECT DISTINCT ON (order_id)
              order_id AS "orderId", shipment_id AS "shipmentId", elchi_status AS "elchiStatus",
              match_state AS "state", expected_amount AS "expected", diff
         FROM finance.remittance_item
        WHERE (created_at AT TIME ZONE '${ZONE}')::date = $1::date
        ORDER BY order_id, id DESC`,
      [date],
    )) as Array<{
      orderId: string;
      shipmentId: string | null;
      elchiStatus: string;
      state: 'PENDING' | 'MATCHED' | 'PARTIAL' | 'MISMATCH';
      expected: string | null;
      diff: string | null;
    }>;
    const count = (state: string) =>
      rows.filter((row) => row.state === state).length;
    let expectedTotal = 0;
    let receivedTotal = 0;
    const mismatches: CodDailyCheckMismatchDto[] = [];
    for (const row of rows) {
      if (row.expected === null) continue; // buyurtma hodisasi hali yo‘q
      const expected = moneyFromDb(row.expected);
      const received = expected + moneyFromDb(row.diff ?? '0');
      expectedTotal += expected;
      receivedTotal += received;
      if (row.state === 'MISMATCH')
        mismatches.push({
          orderId: row.orderId,
          shipmentId: row.shipmentId,
          elchiStatus: row.elchiStatus,
          expected,
          received,
          diff: received - expected,
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

  /** Moliya va nazoratchiga xabar; yuborilmasa — keyingi hisoblashda qayta urinadi (`alerted_at` bo‘sh qoladi). */
  private async alert(
    date: string,
    mismatches: CodDailyCheckMismatchDto[],
  ): Promise<Date | null> {
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
        this.notifications.emit(COD_RECONCILIATION_MISMATCH_EVENT, event),
        { defaultValue: undefined },
      );
    } catch (error) {
      this.logger.error(
        `Sverka farqi (${date}) xabari yuborilmadi: ${(error as Error).message}`,
      );
      return null;
    }
    this.logger.warn(
      `Sverka farqi (${date}): ${event.mismatchCount} buyurtma, farq ${event.diffTotal}`,
    );
    const updated = (await this.dataSource.query(
      `UPDATE finance.cod_daily_check SET alerted_at = now()
        WHERE check_date = $1::date RETURNING alerted_at`,
      [date],
    )) as unknown[];
    // TypeORM UPDATE … RETURNING uchun [qatorlar, soni] qaytaradi
    const rows = (Array.isArray(updated[0]) ? updated[0] : updated) as Array<{
      alerted_at: Date;
    }>;
    return rows[0]?.alerted_at ?? null;
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
