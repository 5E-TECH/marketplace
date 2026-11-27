import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  CatalogAttentionVariantsResult,
  FINANCE_SETTLEMENT_RPC,
  FinanceReadySettlement,
  InventoryAttentionResult,
  RmqClient,
  sendRpc,
  WHOLESALER_ATTENTION_RPC,
  WholesalerActItemDto,
  WholesalerActKind,
  WholesalerAttentionDto,
  WholesalerAttentionKind,
  WholesalerSettlementDto,
  WholesalerSettlementPageDto,
} from '@app/common';

/** Mingliklar bo‘sh joy bilan (12 345 678) — finance akt-sverka PDF i bilan bir xil. */
const money = (n: number) =>
  n.toLocaleString('ru-RU').replace(/[\u00a0\u202f]/g, ' ');
/** `YYYY-MM-DD` → `DD.MM` / `DD.MM.YYYY`. */
const dayMonth = (day: string) =>
  day.slice(5, 10).split('-').reverse().join('.');
const dmy = (day: string) => day.slice(0, 10).split('-').reverse().join('.');
/** Akt-sverka ro‘yxati — bitta so‘rovda finance chegarasi (100). */
const SETTLEMENTS_LIMIT = 100;

/**
 * BE-25 (FE-25): admin optoviklar sahifasi — «Diqqat talab qiladi» va optovik aktlari. Uch servisdan yig‘iladi:
 * catalog (optoviklar va variantlar), inventory (postavka, qoldiq, brak), finance (akt-sverka).
 */
@Injectable()
export class WholesalerAttentionService {
  constructor(
    @Inject(RmqClient.CATALOG) private readonly catalog: ClientProxy,
    @Inject(RmqClient.INVENTORY) private readonly inventory: ClientProxy,
    @Inject(RmqClient.FINANCE) private readonly finance: ClientProxy,
  ) {}

  async attention(): Promise<WholesalerAttentionDto[]> {
    const [catalog, ready] = await Promise.all([
      sendRpc<CatalogAttentionVariantsResult>(
        this.catalog,
        { cmd: WHOLESALER_ATTENTION_RPC.CATALOG_VARIANTS },
        {},
      ),
      sendRpc<FinanceReadySettlement[]>(
        this.finance,
        { cmd: WHOLESALER_ATTENTION_RPC.FINANCE_READY },
        {},
      ),
    ]);
    const stock = await sendRpc<InventoryAttentionResult>(
      this.inventory,
      { cmd: WHOLESALER_ATTENTION_RPC.INVENTORY_ATTENTION },
      {
        variants: catalog.variants,
        wholesalerIds: catalog.wholesalers.map((w) => String(w.id)),
      },
    );
    const names = new Map(
      catalog.wholesalers.map((w) => [String(w.id), w.name]),
    );
    const products = new Map(
      catalog.variants.map((v) => [
        String(v.productId),
        { name: v.productName, wholesalerId: String(v.wholesalerId) },
      ]),
    );
    // o‘chirilgan optovikning yozuvlari chiqmaydi
    const known = (wholesalerId: string) => names.has(String(wholesalerId));
    const base = (wholesalerId: string) => ({
      wholesalerId: String(wholesalerId),
      wholesalerName: names.get(String(wholesalerId)) ?? '',
    });
    const items: WholesalerAttentionDto[] = [];
    for (const s of stock.defectShipments)
      if (known(s.wholesalerId))
        items.push({
          kind: WholesalerAttentionKind.SHIPMENT_DEFECT,
          id: `defect-${s.shipmentId}`,
          ...base(s.wholesalerId),
          shipmentId: s.shipmentId,
          shipmentCode: s.code,
          productName: s.productName,
          declared: s.declared,
          received: s.received,
          defect: s.defect,
        });
    for (const s of stock.outOfStock) {
      const product = products.get(String(s.productId));
      if (!product || !known(product.wholesalerId)) continue;
      items.push({
        kind: WholesalerAttentionKind.OUT_OF_STOCK,
        id: `stock-${s.productId}`,
        ...base(product.wholesalerId),
        productId: String(s.productId),
        productName: product.name,
        onHand: s.onHand,
        reserved: s.reserved,
        blocked: s.blocked,
        incomingCode: s.incomingCode,
        incomingQty: s.incomingQty,
      });
    }
    for (const d of stock.defectByWholesaler)
      if (known(d.wholesalerId))
        items.push({
          kind: WholesalerAttentionKind.DEFECT_NOT_RETURNED,
          id: `returns-${d.wholesalerId}`,
          ...base(d.wholesalerId),
          quantity: d.quantity,
          fromReceiving: d.fromReceiving,
          receivingCodes: d.receivingCodes,
          fromReturns: d.fromReturns,
          returnCodes: d.returnCodes,
        });
    for (const s of ready)
      if (known(s.wholesalerId))
        items.push({
          kind: WholesalerAttentionKind.SETTLEMENT_READY,
          id: `act-${s.id}`,
          ...base(s.wholesalerId),
          settlementId: s.id,
          code: s.number,
          periodFrom: s.periodStart,
          periodTo: s.periodEnd,
          amount: s.amount,
        });
    return items;
  }

  /** Optovik aktlari: brak akti, qabuldagi farq akti, akt-sverka; yangisi tepada. Optovik yo‘q — 404. */
  async acts(wholesalerId: string): Promise<WholesalerActItemDto[]> {
    await sendRpc(
      this.catalog,
      { cmd: 'catalog.wholesaler.admin-get' },
      { id: wholesalerId },
    );
    const catalog = await sendRpc<CatalogAttentionVariantsResult>(
      this.catalog,
      { cmd: WHOLESALER_ATTENTION_RPC.CATALOG_VARIANTS },
      { wholesalerId },
    );
    const [stockActs, settlements] = await Promise.all([
      sendRpc<
        Array<Omit<WholesalerActItemDto, 'sentAt' | 'at'> & { at: string }>
      >(
        this.inventory,
        { cmd: WHOLESALER_ATTENTION_RPC.INVENTORY_ACTS },
        { wholesalerId, variants: catalog.variants },
      ),
      sendRpc<WholesalerSettlementPageDto>(
        this.finance,
        { cmd: FINANCE_SETTLEMENT_RPC.LIST },
        { query: { wholesalerId, page: 1, limit: SETTLEMENTS_LIMIT } },
      ),
    ]);
    const acts: WholesalerActItemDto[] = [
      ...stockActs.map((act) => ({
        ...act,
        at: act.at ? new Date(act.at) : null,
        sentAt: null,
      })),
      ...settlements.items.map((s) => this.settlementAct(s)),
    ];
    return acts.sort(
      (a, b) =>
        (b.at ? new Date(b.at).getTime() : 0) -
          (a.at ? new Date(a.at).getTime() : 0) || b.code.localeCompare(a.code),
    );
  }

  private settlementAct(s: WholesalerSettlementDto): WholesalerActItemDto {
    const payout =
      s.exportedTotal ?? Math.max(0, s.totalAmount - s.debtDeducted);
    return {
      id: s.number,
      kind: WholesalerActKind.SETTLEMENT,
      code: s.number,
      title: `${dayMonth(s.periodStart)}–${dmy(s.periodEnd)} · o‘tkaziladi ${money(payout)} so‘m`,
      at: s.createdAt ? new Date(s.createdAt) : null,
      sentAt: null,
    };
  }
}
