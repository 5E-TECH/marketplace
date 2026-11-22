import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { moneyFromDb, runAsLeader } from '@app/common';

export interface BalanceCheckResult {
  ok: boolean;
  diffAbsTotal: number;
  details: {
    accounts: Array<{
      accountId: string;
      type: string;
      ownerId: string;
      hold: number;
      holdSum: number;
      available: number;
      availableSum: number;
      reversedSum: number;
    }>;
    unbalancedJournals: Array<{ journalId: string; sum: number }>;
    grossMismatch: Array<{ journalId: string; gross: number; lines: number }>;
    openRemittances: Array<{ orderId: string; match: string }>;
  };
}

/**
 * Kechki balans tekshiruvi (BE-22 qabul mezoni: «Qoldiq = yozuvlar yig'indisi»,
 * «Kechki tekshiruvda farq 0»; TZ T8, MOL-1). Bitta REPEATABLE READ snapshot:
 * - har hisobda kesh balans = HOLD / AVAILABLE yozuvlar yig'indisi;
 * - REVERSED yozuvlar yig'indisi 0 (asl + ko'zgu);
 * - har jurnal yig'indisi 0;
 * - yetkazildi jurnalida COD dan boshqa qatorlar = sotuv summasi;
 * - yopilmagan Elchi o'tkazmalari ro'yxati.
 * Vaqt [taklif]: har kuni 03:00 Toshkent (DZ-07 da vaqt yo'q).
 */
@Injectable()
export class BalanceCheckService {
  private readonly logger = new Logger(BalanceCheckService.name);

  constructor(private readonly dataSource: DataSource) {}

  @Cron('0 0 3 * * *', {
    name: 'finance-balance-check',
    timeZone: 'Asia/Tashkent',
    waitForCompletion: true,
  })
  async nightly(): Promise<void> {
    await runAsLeader(this.dataSource, 'finance-balance-check', () =>
      this.run(),
    );
  }

  async run(): Promise<BalanceCheckResult> {
    const startedAt = new Date().toISOString();
    const result = await this.dataSource.transaction(
      'REPEATABLE READ',
      async (m) => {
        const accounts = (
          (await m.query(
            `SELECT a.id::text AS "accountId", a.type, a.owner_id AS "ownerId",
                  a.hold_balance AS hold, a.available_balance AS available,
                  COALESCE(SUM(e.amount) FILTER (WHERE e.state='HOLD'),0) AS "holdSum",
                  COALESCE(SUM(e.amount) FILTER (WHERE e.state='AVAILABLE'),0) AS "availableSum",
                  COALESCE(SUM(e.amount) FILTER (WHERE e.state='REVERSED'),0) AS "reversedSum"
             FROM finance.account a LEFT JOIN finance.ledger_entry e ON e.account_id = a.id
            GROUP BY a.id ORDER BY a.id`,
          )) as Array<Record<string, string>>
        ).map((r) => ({
          accountId: r.accountId,
          type: r.type,
          ownerId: r.ownerId,
          hold: moneyFromDb(r.hold),
          holdSum: moneyFromDb(r.holdSum),
          available: moneyFromDb(r.available),
          availableSum: moneyFromDb(r.availableSum),
          reversedSum: moneyFromDb(r.reversedSum),
        }));
        const unbalancedJournals = (
          (await m.query(
            `SELECT journal_id::text AS "journalId", SUM(amount) AS sum
             FROM finance.ledger_entry GROUP BY journal_id HAVING SUM(amount) <> 0`,
          )) as Array<{ journalId: string; sum: string }>
        ).map((r) => ({ journalId: r.journalId, sum: moneyFromDb(r.sum) }));
        const grossMismatch = (
          (await m.query(
            `SELECT j.id::text AS "journalId", j.gross_amount AS gross,
                  COALESCE(SUM(e.amount) FILTER (WHERE e.line_kind <> 'COD_RECEIVABLE'),0) AS lines
             FROM finance.journal j JOIN finance.ledger_entry e
               ON e.journal_id = j.id AND e.reverses_entry_id IS NULL
            WHERE j.kind = 'ORDER_DELIVERED'
            GROUP BY j.id
           HAVING j.gross_amount <> COALESCE(SUM(e.amount) FILTER (WHERE e.line_kind <> 'COD_RECEIVABLE'),0)`,
          )) as Array<{ journalId: string; gross: string; lines: string }>
        ).map((r) => ({
          journalId: r.journalId,
          gross: moneyFromDb(r.gross),
          lines: moneyFromDb(r.lines),
        }));
        const openRemittances = (await m.query(
          `SELECT DISTINCT order_id AS "orderId", match_state AS match
           FROM finance.remittance_item WHERE match_state <> 'MATCHED' AND resolved_at IS NULL ORDER BY 1`,
        )) as Array<{ orderId: string; match: string }>;
        let diff = 0;
        for (const a of accounts) {
          diff +=
            Math.abs(a.hold - a.holdSum) +
            Math.abs(a.available - a.availableSum) +
            Math.abs(a.reversedSum);
        }
        for (const j of unbalancedJournals) diff += Math.abs(j.sum);
        for (const g of grossMismatch) diff += Math.abs(g.gross - g.lines);
        return {
          ok: diff === 0,
          diffAbsTotal: diff,
          details: {
            accounts: accounts.filter(
              (a) =>
                a.hold !== a.holdSum ||
                a.available !== a.availableSum ||
                a.reversedSum !== 0,
            ),
            unbalancedJournals,
            grossMismatch,
            openRemittances,
          },
        };
      },
    );
    await this.dataSource.query(
      `INSERT INTO finance.balance_check (started_at, finished_at, ok, diff_abs_total, details)
       VALUES ($1, now(), $2, $3, $4::jsonb)`,
      [
        startedAt,
        result.ok,
        result.diffAbsTotal,
        JSON.stringify(result.details),
      ],
    );
    if (!result.ok)
      this.logger.error(
        `Moliya balans tekshiruvi: farq ${result.diffAbsTotal} so‘m`,
      );
    return result;
  }

  async latest(): Promise<Record<string, unknown> | null> {
    const [row] = (await this.dataSource.query(
      `SELECT id::text, started_at AS "startedAt", finished_at AS "finishedAt", ok,
              diff_abs_total AS "diffAbsTotal", details
         FROM finance.balance_check ORDER BY id DESC LIMIT 1`,
    )) as Array<Record<string, unknown>>;
    return row
      ? { ...row, diffAbsTotal: moneyFromDb(row.diffAbsTotal as string) }
      : null;
  }
}
