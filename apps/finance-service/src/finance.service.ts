import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import {
  CommissionType,
  CreateCommissionDto,
  FinanceLedgerEntryType,
  FinancePageQueryDto,
  FinancePayoutQueryDto,
  FinancePayoutRequestedEvent,
  FinancePayoutStatus,
  FinanceRefundRequestedEvent,
  UpdateCommissionDto,
} from '@app/common';

export interface LedgerRow {
  id: string;
  shopId: string;
  entryType: FinanceLedgerEntryType;
  amount: number;
  balanceAfter: number;
  referenceType: string;
  referenceId: string;
  createdAt: Date;
}

export interface PayoutRow {
  id: string;
  shopId: string;
  amount: number;
  status: FinancePayoutStatus;
  method: string | null;
  referenceId: string;
  paidAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CommissionRow {
  id: string;
  shopId: string | null;
  categoryId: string | null;
  type: CommissionType;
  value: number;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class FinanceService {
  constructor(private readonly dataSource: DataSource) {}

  processPayoutRequested(
    event: FinancePayoutRequestedEvent,
  ): Promise<{ payout: PayoutRow; balance: number; idempotent: boolean }> {
    if (!event?.sellerOrderId || !event?.shopId || Number(event.amount) <= 0) {
      throw new BadRequestException('Payout eventi noto‘g‘ri');
    }
    return this.dataSource.transaction(async (manager) => {
      await this.lockShop(manager, event.shopId);
      const existing = await this.payoutByReference(
        manager,
        event.sellerOrderId,
      );
      if (existing) {
        return {
          payout: existing,
          balance: await this.balance(manager, event.shopId),
          idempotent: true,
        };
      }

      const saleAmount = this.money(event.amount);
      const commission = await this.commissionFor(manager, event.shopId);
      const commissionAmount = this.commissionAmount(saleAmount, commission);
      let balance = await this.balance(manager, event.shopId);
      balance = this.money(balance + saleAmount);
      await this.insertLedger(manager, {
        shopId: event.shopId,
        entryType: FinanceLedgerEntryType.SALE,
        amount: saleAmount,
        balance,
        referenceType: 'seller_order',
        referenceId: event.sellerOrderId,
      });
      balance = this.money(balance - commissionAmount);
      await this.insertLedger(manager, {
        shopId: event.shopId,
        entryType: FinanceLedgerEntryType.COMMISSION,
        amount: -commissionAmount,
        balance,
        referenceType: 'seller_order',
        referenceId: event.sellerOrderId,
      });

      const [payout] = (await manager.query(
        `INSERT INTO finance.payout
          (shop_id,amount,status,method,reference_id)
         VALUES($1,$2,$3,$4,$5)
         RETURNING id::text,"shop_id"::text AS "shopId",amount::float8,
                   status,method,"reference_id" AS "referenceId",
                   "paid_at" AS "paidAt","created_at" AS "createdAt",
                   "updated_at" AS "updatedAt"`,
        [
          event.shopId,
          this.money(saleAmount - commissionAmount),
          FinancePayoutStatus.PENDING,
          null,
          event.sellerOrderId,
        ],
      )) as PayoutRow[];
      return { payout, balance, idempotent: false };
    });
  }

  refund(
    event: FinanceRefundRequestedEvent,
  ): Promise<{ entry: LedgerRow; balance: number; idempotent: boolean }> {
    if (!event?.sellerOrderId || !event?.shopId) {
      throw new BadRequestException('Refund eventi noto‘g‘ri');
    }
    return this.dataSource.transaction(async (manager) => {
      await this.lockShop(manager, event.shopId);
      const [existing] = (await manager.query(
        `SELECT id::text,"shop_id"::text AS "shopId","entry_type" AS "entryType",
                amount::float8,"balance_after"::float8 AS "balanceAfter",
                "reference_type" AS "referenceType","reference_id" AS "referenceId",
                "created_at" AS "createdAt"
           FROM finance.seller_ledger
          WHERE shop_id=$1 AND entry_type=$2 AND reference_type='seller_order_refund'
            AND reference_id=$3`,
        [event.shopId, FinanceLedgerEntryType.REFUND, event.sellerOrderId],
      )) as LedgerRow[];
      if (existing) {
        return {
          entry: existing,
          balance: Number(existing.balanceAfter),
          idempotent: true,
        };
      }

      const source = (await manager.query(
        `SELECT entry_type AS "entryType",amount::float8
           FROM finance.seller_ledger
          WHERE shop_id=$1 AND reference_type='seller_order' AND reference_id=$2
            AND entry_type IN ('SALE','COMMISSION')`,
        [event.shopId, event.sellerOrderId],
      )) as Array<{ entryType: FinanceLedgerEntryType; amount: number }>;
      if (!source.length) throw new NotFoundException('Asl savdo topilmadi');
      const net = this.money(
        source.reduce((total, row) => total + Number(row.amount), 0),
      );
      const balance = this.money(
        (await this.balance(manager, event.shopId)) - net,
      );
      const entry = await this.insertLedger(manager, {
        shopId: event.shopId,
        entryType: FinanceLedgerEntryType.REFUND,
        amount: -net,
        balance,
        referenceType: 'seller_order_refund',
        referenceId: event.sellerOrderId,
      });
      await manager.query(
        `UPDATE finance.payout SET status='HELD',updated_at=now()
          WHERE reference_id=$1 AND status IN ('PENDING','APPROVED')`,
        [event.sellerOrderId],
      );
      return { entry, balance, idempotent: false };
    });
  }

  approvePayout(id: string) {
    return this.setPayoutStatus(id, FinancePayoutStatus.APPROVED);
  }

  holdPayout(id: string) {
    return this.setPayoutStatus(id, FinancePayoutStatus.HELD);
  }

  releasePayout(id: string): Promise<PayoutRow> {
    return this.dataSource.transaction(async (manager) => {
      const snapshot = await this.payoutById(manager, id, false);
      if (!snapshot) throw new NotFoundException('Payout topilmadi');
      await this.lockShop(manager, snapshot.shopId);
      const payout = await this.payoutById(manager, id, true);
      if (!payout) throw new NotFoundException('Payout topilmadi');
      if (payout.status === FinancePayoutStatus.PAID) return payout;
      if (payout.status !== FinancePayoutStatus.APPROVED) {
        throw new ConflictException('Faqat APPROVED payout release qilinadi');
      }
      const currentBalance = await this.balance(manager, payout.shopId);
      if (currentBalance < Number(payout.amount)) {
        throw new ConflictException('Ledger balansi payout uchun yetarli emas');
      }
      await this.insertLedger(manager, {
        shopId: payout.shopId,
        entryType: FinanceLedgerEntryType.PAYOUT,
        amount: -Number(payout.amount),
        balance: this.money(currentBalance - Number(payout.amount)),
        referenceType: 'payout',
        referenceId: payout.id,
      });
      const [updated] = (await manager.query(
        `UPDATE finance.payout
            SET status='PAID',paid_at=now(),updated_at=now()
          WHERE id=$1
          RETURNING id::text,"shop_id"::text AS "shopId",amount::float8,
                    status,method,"reference_id" AS "referenceId",
                    "paid_at" AS "paidAt","created_at" AS "createdAt",
                    "updated_at" AS "updatedAt"`,
        [id],
      )) as PayoutRow[];
      return updated;
    });
  }

  async listLedger(query: FinancePageQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const params: unknown[] = [];
    const where = query.shopId
      ? `WHERE shop_id=$${params.push(query.shopId)}`
      : '';
    const [{ total }] = (await this.dataSource.query(
      `SELECT COUNT(*)::int AS total FROM finance.seller_ledger ${where}`,
      params,
    )) as Array<{ total: number }>;
    const rows = await this.dataSource.query(
      `SELECT id::text,"shop_id"::text AS "shopId","entry_type" AS "entryType",
              amount::float8,"balance_after"::float8 AS "balanceAfter",
              "reference_type" AS "referenceType","reference_id" AS "referenceId",
              "created_at" AS "createdAt"
         FROM finance.seller_ledger ${where}
        ORDER BY created_at DESC,id DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, (page - 1) * limit],
    );
    return this.page(rows, Number(total), page, limit);
  }

  async listPayouts(query: FinancePayoutQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const params: unknown[] = [];
    const conditions: string[] = [];
    if (query.shopId) conditions.push(`shop_id=$${params.push(query.shopId)}`);
    if (query.status) conditions.push(`status=$${params.push(query.status)}`);
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const [{ total }] = (await this.dataSource.query(
      `SELECT COUNT(*)::int AS total FROM finance.payout ${where}`,
      params,
    )) as Array<{ total: number }>;
    const rows = await this.dataSource.query(
      `SELECT id::text,"shop_id"::text AS "shopId",amount::float8,status,method,
              "reference_id" AS "referenceId","paid_at" AS "paidAt",
              "created_at" AS "createdAt","updated_at" AS "updatedAt"
         FROM finance.payout ${where}
        ORDER BY created_at DESC,id DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, (page - 1) * limit],
    );
    return this.page(rows, Number(total), page, limit);
  }

  listCommissions(): Promise<CommissionRow[]> {
    return this.dataSource.query(
      `SELECT id::text,"shop_id"::text AS "shopId",
              "category_id"::text AS "categoryId",type,value::float8,
              "created_at" AS "createdAt","updated_at" AS "updatedAt"
         FROM finance.commission ORDER BY shop_id NULLS LAST,category_id NULLS LAST,id`,
    );
  }

  upsertCommission(dto: CreateCommissionDto): Promise<CommissionRow> {
    const refId = this.commissionRef(dto.scope, dto.refId);
    return this.dataSource.transaction(async (manager) => {
      const scopeColumn =
        dto.scope === 'shop'
          ? 'shop_id'
          : dto.scope === 'category'
            ? 'category_id'
            : null;
      const existingSql = scopeColumn
        ? `SELECT id::text FROM finance.commission WHERE ${scopeColumn}=$1`
        : `SELECT id::text FROM finance.commission WHERE shop_id IS NULL AND category_id IS NULL`;
      const [existing] = await manager.query(
        existingSql,
        scopeColumn ? [refId] : [],
      );
      if (existing) {
        return this.updateCommissionWithManager(
          manager,
          String(existing.id),
          dto,
        );
      }
      const [created] = (await manager.query(
        `INSERT INTO finance.commission(shop_id,category_id,type,value)
         VALUES($1,$2,$3,$4)
         RETURNING id::text,"shop_id"::text AS "shopId",
                   "category_id"::text AS "categoryId",type,value::float8,
                   "created_at" AS "createdAt","updated_at" AS "updatedAt"`,
        [
          dto.scope === 'shop' ? refId : null,
          dto.scope === 'category' ? refId : null,
          dto.type,
          dto.value,
        ],
      )) as CommissionRow[];
      return created;
    });
  }

  updateCommission(id: string, dto: UpdateCommissionDto) {
    return this.dataSource.transaction((manager) =>
      this.updateCommissionWithManager(manager, id, dto),
    );
  }

  private async updateCommissionWithManager(
    manager: EntityManager,
    id: string,
    dto: UpdateCommissionDto,
  ): Promise<CommissionRow> {
    const [updated] = (await manager.query(
      `UPDATE finance.commission
          SET type=COALESCE($2,type),value=COALESCE($3,value),updated_at=now()
        WHERE id=$1
        RETURNING id::text,"shop_id"::text AS "shopId",
                  "category_id"::text AS "categoryId",type,value::float8,
                  "created_at" AS "createdAt","updated_at" AS "updatedAt"`,
      [id, dto.type ?? null, dto.value ?? null],
    )) as CommissionRow[];
    if (!updated) throw new NotFoundException('Komissiya topilmadi');
    return updated;
  }

  private async setPayoutStatus(
    id: string,
    status: FinancePayoutStatus.APPROVED | FinancePayoutStatus.HELD,
  ): Promise<PayoutRow> {
    const [row] = (await this.dataSource.query(
      `UPDATE finance.payout SET status=$2,updated_at=now()
        WHERE id=$1 AND status<>'PAID'
        RETURNING id::text,"shop_id"::text AS "shopId",amount::float8,
                  status,method,"reference_id" AS "referenceId",
                  "paid_at" AS "paidAt","created_at" AS "createdAt",
                  "updated_at" AS "updatedAt"`,
      [id, status],
    )) as PayoutRow[];
    if (row) return row;
    const existing = await this.payoutById(this.dataSource.manager, id, false);
    if (!existing) throw new NotFoundException('Payout topilmadi');
    throw new ConflictException(
      'To‘langan payout holatini o‘zgartirib bo‘lmaydi',
    );
  }

  private commissionRef(
    scope: CreateCommissionDto['scope'],
    refId?: string,
  ): string | null {
    if (scope === 'global') {
      if (refId)
        throw new BadRequestException('Global scope uchun refId kerak emas');
      return null;
    }
    if (!refId)
      throw new BadRequestException(`${scope} scope uchun refId kerak`);
    return refId;
  }

  private async commissionFor(
    manager: EntityManager,
    shopId: string,
  ): Promise<Pick<CommissionRow, 'type' | 'value'> | null> {
    const [row] = (await manager.query(
      `SELECT type,value::float8
         FROM finance.commission
        WHERE shop_id=$1 OR (shop_id IS NULL AND category_id IS NULL)
        ORDER BY (shop_id IS NOT NULL) DESC,id DESC LIMIT 1`,
      [shopId],
    )) as CommissionRow[];
    return row ?? null;
  }

  private commissionAmount(
    amount: number,
    commission: Pick<CommissionRow, 'type' | 'value'> | null,
  ): number {
    if (!commission) return 0;
    const calculated =
      commission.type === CommissionType.PERCENT
        ? (amount * Number(commission.value)) / 100
        : Number(commission.value);
    return this.money(Math.min(amount, Math.max(0, calculated)));
  }

  private async lockShop(manager: EntityManager, shopId: string) {
    await manager.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
      `finance-shop:${shopId}`,
    ]);
  }

  private async balance(manager: EntityManager, shopId: string) {
    const [row] = await manager.query(
      `SELECT balance_after::float8 AS balance
         FROM finance.seller_ledger WHERE shop_id=$1
        ORDER BY created_at DESC,id DESC LIMIT 1`,
      [shopId],
    );
    return this.money(Number(row?.balance ?? 0));
  }

  private async insertLedger(
    manager: EntityManager,
    data: {
      shopId: string;
      entryType: FinanceLedgerEntryType;
      amount: number;
      balance: number;
      referenceType: string;
      referenceId: string;
    },
  ): Promise<LedgerRow> {
    const [row] = (await manager.query(
      `INSERT INTO finance.seller_ledger
        (shop_id,entry_type,amount,balance_after,reference_type,reference_id)
       VALUES($1,$2,$3,$4,$5,$6)
       RETURNING id::text,"shop_id"::text AS "shopId","entry_type" AS "entryType",
                 amount::float8,"balance_after"::float8 AS "balanceAfter",
                 "reference_type" AS "referenceType","reference_id" AS "referenceId",
                 "created_at" AS "createdAt"`,
      [
        data.shopId,
        data.entryType,
        this.money(data.amount),
        this.money(data.balance),
        data.referenceType,
        data.referenceId,
      ],
    )) as LedgerRow[];
    return row;
  }

  private async payoutByReference(
    manager: EntityManager,
    referenceId: string,
  ): Promise<PayoutRow | null> {
    const [row] = (await manager.query(
      `SELECT id::text,"shop_id"::text AS "shopId",amount::float8,status,method,
              "reference_id" AS "referenceId","paid_at" AS "paidAt",
              "created_at" AS "createdAt","updated_at" AS "updatedAt"
         FROM finance.payout WHERE reference_id=$1 FOR UPDATE`,
      [referenceId],
    )) as PayoutRow[];
    return row ?? null;
  }

  private async payoutById(
    manager: EntityManager,
    id: string,
    lock: boolean,
  ): Promise<PayoutRow | null> {
    const [row] = (await manager.query(
      `SELECT id::text,"shop_id"::text AS "shopId",amount::float8,status,method,
              "reference_id" AS "referenceId","paid_at" AS "paidAt",
              "created_at" AS "createdAt","updated_at" AS "updatedAt"
         FROM finance.payout WHERE id=$1${lock ? ' FOR UPDATE' : ''}`,
      [id],
    )) as PayoutRow[];
    return row ?? null;
  }

  private page(items: unknown[], total: number, page: number, limit: number) {
    return {
      items,
      total,
      page,
      limit,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit),
    };
  }

  private money(value: number): number {
    return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
  }
}
