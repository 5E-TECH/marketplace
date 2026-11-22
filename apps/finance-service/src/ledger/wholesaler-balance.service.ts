import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { moneyFromDb, WholesalerMoneyDto } from '@app/common';

/**
 * BE-30 (OPT-3): optovik paneli — pul holati moliya hisobining o‘zidan (BE-22, BE-33):
 * - ushlab turilgan — HOLD dagi optovik bazaviy qatorlari (Elchi puli hali kelmagan sotuvlar);
 * - to‘lanadigan — optovik hisobining mavjud qoldig‘i (o‘tkazmalar ayirilgan);
 * - to‘langan — haftalik o‘tkazmalar («To‘landi», `WHOLESALER_PAYOUT`).
 */
@Injectable()
export class WholesalerBalanceService {
  constructor(private readonly dataSource: DataSource) {}

  async balance(input: { wholesalerId: string }): Promise<WholesalerMoneyDto> {
    const [row] = (await this.dataSource.query(
      `SELECT COALESCE(SUM(e.amount) FILTER (WHERE e.line_kind = 'WHOLESALER_BASE' AND e.state = 'HOLD'), 0)::text AS held,
              COALESCE(-SUM(e.amount) FILTER (WHERE e.line_kind = 'WHOLESALER_PAYOUT'), 0)::text AS paid,
              COALESCE(MAX(a.available_balance), 0)::text AS payable
         FROM finance.account a
         LEFT JOIN finance.ledger_entry e ON e.account_id = a.id
        WHERE a.type = 'WHOLESALER' AND a.owner_id = $1`,
      [String(input?.wholesalerId ?? '')],
    )) as Array<{ held: string; paid: string; payable: string }>;
    return {
      held: moneyFromDb(row?.held ?? '0'),
      payable: moneyFromDb(row?.payable ?? '0'),
      paid: moneyFromDb(row?.paid ?? '0'),
    };
  }
}
