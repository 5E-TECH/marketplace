import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { moneyFromDb } from '@app/common';

/** BE-22 o'qish so'rovlari: hisoblar balansi va buyurtma taqsimoti (BE-28, BE-41 uchun). */
@Injectable()
export class LedgerQueryService {
  constructor(private readonly dataSource: DataSource) {}

  async accounts(type?: string) {
    const rows = (await this.dataSource.query(
      `SELECT id::text, type, NULLIF(owner_id, '') AS "ownerId",
              hold_balance AS "hold", available_balance AS "available"
         FROM finance.account WHERE ($1::text IS NULL OR type = $1) ORDER BY id`,
      [type ?? null],
    )) as Array<Record<string, string>>;
    return rows.map((r) => ({
      ...r,
      hold: moneyFromDb(r.hold),
      available: moneyFromDb(r.available),
    }));
  }

  async orderSplit(orderId: string) {
    const rows = (await this.dataSource.query(
      `SELECT j.kind AS "journal", e.line_kind AS "lineKind", a.type AS "account",
              NULLIF(a.owner_id, '') AS "ownerId", e.item_seq AS "itemSeq",
              e.product_id AS "productId", e.amount, e.state
         FROM finance.journal j
         JOIN finance.ledger_entry e ON e.journal_id = j.id
         JOIN finance.account a ON a.id = e.account_id
        WHERE j.order_id = $1
        ORDER BY j.id, e.id`,
      [orderId],
    )) as Array<Record<string, string>>;
    return rows.map((r) => ({ ...r, amount: moneyFromDb(r.amount) }));
  }
}
