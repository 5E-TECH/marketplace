import { ApiProperty } from '@nestjs/swagger';

/**
 * BE-25 (FE-25): admin optoviklar sahifasi — «Diqqat talab qiladi» (`GET /admin/wholesalers/attention`) va optovik
 * aktlari ro‘yxati (`GET /admin/wholesalers/:id/acts`). «Diqqat talab qiladi» bloki dizaynda [taklif] (p-a4.md 101),
 * FE taklifi `docs/api-taklif/fe-25-admin-optovik.md` §4–§5 bo‘yicha.
 */
export enum WholesalerAttentionKind {
  /** Qabulda farq (DISCREPANCY) chiqqan postavka. */
  SHIPMENT_DEFECT = 'SHIPMENT_DEFECT',
  /** Sotuvdagi mahsulotning sotsa bo‘ladigan qoldig‘i 0. */
  OUT_OF_STOCK = 'OUT_OF_STOCK',
  /** Brak (qabulda va qaytgan tovardan) optovikka hali qaytarilmagan. */
  DEFECT_NOT_RETURNED = 'DEFECT_NOT_RETURNED',
  /** Akt-sverka «Tayyor», optovik hali qabul qilmagan va e’tiroz bildirmagan. */
  SETTLEMENT_READY = 'SETTLEMENT_READY',
}

export enum WholesalerActKind {
  DEFECT = 'DEFECT',
  RECEIVING = 'RECEIVING',
  SETTLEMENT = 'SETTLEMENT',
}

class WholesalerAttentionBaseDto {
  @ApiProperty({ example: 'defect-14', description: 'Ro‘yxatdagi kalit' })
  id: string;

  @ApiProperty({ example: '7' }) wholesalerId: string;

  @ApiProperty({ example: '«Toshkent Savdo» MChJ' }) wholesalerName: string;
}

export class WholesalerAttentionShipmentDefectDto extends WholesalerAttentionBaseDto {
  @ApiProperty({
    enum: [WholesalerAttentionKind.SHIPMENT_DEFECT],
    example: WholesalerAttentionKind.SHIPMENT_DEFECT,
  })
  kind: WholesalerAttentionKind.SHIPMENT_DEFECT;

  @ApiProperty({ example: '14' }) shipmentId: string;

  @ApiProperty({ example: 'PS-000014', description: 'Postavka va akt raqami' })
  shipmentCode: string;

  @ApiProperty({
    example: 'Bolalar termos shishasi',
    description: 'Postavkadagi birinchi mahsulot',
  })
  productName: string;

  @ApiProperty({ example: 100, description: 'E’lon qilingan, dona' })
  declared: number;

  @ApiProperty({ example: 100, description: 'Sanalgan (brak bilan), dona' })
  received: number;

  @ApiProperty({ example: 2, description: 'Brak, dona' })
  defect: number;
}

export class WholesalerAttentionOutOfStockDto extends WholesalerAttentionBaseDto {
  @ApiProperty({
    enum: [WholesalerAttentionKind.OUT_OF_STOCK],
    example: WholesalerAttentionKind.OUT_OF_STOCK,
  })
  kind: WholesalerAttentionKind.OUT_OF_STOCK;

  @ApiProperty({ example: '42' }) productId: string;

  @ApiProperty({ example: 'Elektr choynak' }) productName: string;

  @ApiProperty({ example: 3, description: 'Omborda (bandi bilan), dona' })
  onHand: number;

  @ApiProperty({ example: 3, description: 'Bandda, dona' })
  reserved: number;

  @ApiProperty({
    example: 'PS-000015',
    nullable: true,
    type: String,
    description: 'Shu mahsulot bilan kelayotgan eng yaqin postavka',
  })
  incomingCode: string | null;

  @ApiProperty({
    example: 40,
    description:
      'O‘sha postavkada shu mahsulotdan e’lon qilingan dona; postavka yo‘q — 0',
  })
  incomingQty: number;
}

export class WholesalerAttentionDefectNotReturnedDto extends WholesalerAttentionBaseDto {
  @ApiProperty({
    enum: [WholesalerAttentionKind.DEFECT_NOT_RETURNED],
    example: WholesalerAttentionKind.DEFECT_NOT_RETURNED,
  })
  kind: WholesalerAttentionKind.DEFECT_NOT_RETURNED;

  @ApiProperty({
    example: 3,
    description:
      'Optovikka qaytarilmagan brak, dona. Optovikka qaytarish operatsiyasi hali yo‘q — faqat o‘sadi (ega savoli)',
  })
  quantity: number;

  @ApiProperty({ example: 2, description: 'Qabuldagi brak, dona' })
  fromReceiving: number;

  @ApiProperty({ type: [String], example: ['PS-000014'] })
  receivingCodes: string[];

  @ApiProperty({
    example: 1,
    description: 'Qaytgan tovarni saralashdagi brak, dona',
  })
  fromReturns: number;

  @ApiProperty({ type: [String], example: ['L-1031'] })
  returnCodes: string[];
}

export class WholesalerAttentionSettlementReadyDto extends WholesalerAttentionBaseDto {
  @ApiProperty({
    enum: [WholesalerAttentionKind.SETTLEMENT_READY],
    example: WholesalerAttentionKind.SETTLEMENT_READY,
  })
  kind: WholesalerAttentionKind.SETTLEMENT_READY;

  @ApiProperty({ example: '12' }) settlementId: string;

  @ApiProperty({ example: 'AS-000012' }) code: string;

  @ApiProperty({ example: '2027-01-04', description: 'Davr boshi' })
  periodFrom: string;

  @ApiProperty({ example: '2027-01-10', description: 'Davr oxiri' })
  periodTo: string;

  @ApiProperty({
    example: 280000,
    description: 'O‘tkaziladigan summa, so‘m (qarz ushlanganidan keyin)',
  })
  amount: number;
}

export type WholesalerAttentionDto =
  | WholesalerAttentionShipmentDefectDto
  | WholesalerAttentionOutOfStockDto
  | WholesalerAttentionDefectNotReturnedDto
  | WholesalerAttentionSettlementReadyDto;

/** Optovikka yuboriladigan akt (FE-25 «Aktlar»). */
export class WholesalerActItemDto {
  @ApiProperty({ example: 'PS-000014', description: 'Akt kaliti (= `code`)' })
  id: string;

  @ApiProperty({
    enum: WholesalerActKind,
    example: WholesalerActKind.RECEIVING,
  })
  kind: WholesalerActKind;

  @ApiProperty({
    example: 'PS-000014',
    description:
      'Brak akti — `BA-<buyurtma>` [taklif]; qabul akti — postavka raqami; akt-sverka — `AS-…`',
  })
  code: string;

  @ApiProperty({ example: 'Bolalar termos shishasi · farq: 2 brak' })
  title: string;

  @ApiProperty({
    example: '2026-12-29T05:00:00.000Z',
    nullable: true,
    type: Date,
    description: 'Akt sanasi: saralash, qabul yoki akt-sverka tuzilgan vaqt',
  })
  at: Date | null;

  @ApiProperty({
    example: null,
    nullable: true,
    type: Date,
    description:
      'Optovikka yuborilgan vaqt — hozir doim null: aktni yuborish (kanal va yo‘l) ega qarorini kutadi (savollar-M1 104)',
  })
  sentAt: Date | null;
}

/** Ichki RPC lar: catalog variantlari, inventory hisobi, finance tayyor aktlari. */
export const WHOLESALER_ATTENTION_RPC = {
  /** catalog: optoviklar (nom) va ularning variantlari, `onSale` bilan; `wholesalerId` — faqat shu optovik. */
  CATALOG_VARIANTS: 'catalog.wholesaler.attention-variants',
  INVENTORY_ATTENTION: 'inventory.wholesaler.attention',
  INVENTORY_ACTS: 'inventory.wholesaler.acts',
  /** finance: «Tayyor», optovik qabul qilmagan va ochiq e’tirozi yo‘q aktlar. */
  FINANCE_READY: 'finance.settlement.attention',
} as const;

export interface AttentionVariant {
  wholesalerId: string;
  productId: string;
  productName: string;
  variantId: string;
  sku: string;
  /** Sotuvda: CPA, faol, to‘xtatilmagan mahsulot, faol optovik, faol variant (offer qoidasi). */
  onSale: boolean;
}

export interface CatalogAttentionVariantsResult {
  wholesalers: Array<{ id: string; name: string }>;
  variants: AttentionVariant[];
}

export interface InventoryAttentionResult {
  defectShipments: Array<{
    shipmentId: string;
    wholesalerId: string;
    code: string;
    productName: string;
    declared: number;
    received: number;
    defect: number;
  }>;
  outOfStock: Array<{
    productId: string;
    onHand: number;
    reserved: number;
    incomingCode: string | null;
    incomingQty: number;
  }>;
  defectByWholesaler: Array<{
    wholesalerId: string;
    quantity: number;
    fromReceiving: number;
    receivingCodes: string[];
    fromReturns: number;
    returnCodes: string[];
  }>;
}

export interface FinanceReadySettlement {
  id: string;
  number: string;
  wholesalerId: string;
  periodStart: string;
  periodEnd: string;
  amount: number;
}
