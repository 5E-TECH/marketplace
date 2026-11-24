import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { LeadOrderStatus } from './order-events.dto';

/**
 * BE-46 TC3 (ega qarori 2026-11-24, «Avtomatik so‘rov»; savollar-M1 39-savol): Elchi bilan kunlik avtomatik
 * tekshiruv. Fayl o‘rniga tizim har kuni Elchi partner API sidan (`POST /partner/shipments/status`, 100 tagacha
 * posilka bitta so‘rovda — Elchi-Backend `partner-gateway.controller.ts`, M4ViM9jz «hamkor solishtiruvchisi uchun»)
 * posilka holati va pul maydonlarini oladi va o‘zidagi bilan solishtiradi: mos posilkalar faqat sanaladi,
 * farqlilari ro‘yxatda — moliya izoh bilan yopadi (BE-46 sverkasidagi kabi).
 *
 * Elchi pul maydonlari webhook bilan bir manbadan (Elchi-Backend `resolvePartnerMoneyFields`): `collected_from_customer`
 * — kuryer mijozdan yig‘gan naqd (sotilmagan — null), `elchi_fee` — Elchi tarifi, `cod_collected` — Elchi’ning bizga
 * o‘tkazgani (webhookdagi `market_paid_amount` bilan bir xil).
 */
export const ELCHI_CHECK_RPC = {
  /** checkout: tekshiriladigan posilkalar (Elchi’ga topshirilgan lid buyurtmalari). */
  PARCELS: 'checkout.elchi-check.parcels',
  /** elchi-integration: 100 tagacha posilka holati bitta so‘rovda. */
  SHIPMENTS_STATUS: 'integration.shipments.status',
  RUN: 'finance.elchi-check.run',
  GET: 'finance.elchi-check.get',
  ITEMS: 'finance.elchi-check.items',
  RESOLVE: 'finance.elchi-check.resolve',
} as const;

/** Elchi partner API bitta so‘rovda qabul qiladigan posilkalar soni (Elchi-Backend `getPartnerShipmentsBulk`). */
export const ELCHI_STATUS_BATCH_MAX = 100;

/** finance → notification: kunlik tekshiruvda yangi farq (moliya va nazoratchiga). */
export const ELCHI_CHECK_MISMATCH_EVENT = 'finance.elchi.check.mismatch';

export interface ElchiCheckMismatchEvent {
  /** Tekshiruv kuni (Toshkent). */
  date: string;
  runId: string;
  /** Yangi (avvalgi tekshiruvda bo‘lmagan) ochiq farqlar soni. */
  newDiffCount: number;
  /** Tekshiruvdagi hamma ochiq farqlar. */
  openDiffCount: number;
  orders: Array<{
    orderId: string;
    orderNumber: string;
    reasons: ElchiCheckReason[];
  }>;
}

/** checkout → finance: tekshiriladigan posilka. */
export interface ElchiCheckParcel {
  orderId: string;
  orderNumber: string;
  shipmentId: string;
  status: LeadOrderStatus;
  /** Mijozdan olinadigan COD (Elchi’ga yuborilgan `cod_amount`), butun so‘m. */
  codAmount: number;
}

export interface ElchiCheckParcelsResult {
  parcels: ElchiCheckParcel[];
  /** Chegaradan ko‘p posilka bor edi — qolganlari tekshirilmadi. */
  truncated: boolean;
}

/** elchi-integration → finance: Elchi’dagi posilka (partner API `GET /partner/shipments/:id` shakli). */
export interface ElchiShipmentStatus {
  shipmentId: string;
  externalOrderId: string | null;
  /** Elchi buyurtma holati (Elchi-Backend `Order_status`: `on the road`, `sold`, `paid`, …). */
  status: string;
  /** Kuryer mijozdan yig‘gan naqd; sotilmagan — null. */
  collectedFromCustomer: number | null;
  /** Elchi tarifi; noma’lum — null. */
  elchiFee: number | null;
  /** Elchi bizga o‘tkazgani (`cod_collected` = webhookdagi `market_paid_amount`). */
  marketPaidAmount: number;
  /** To‘lanishi kerak summa (`cod_amount`). */
  codAmount: number | null;
  /**
   * Kuryer yozgan qo‘shimcha xarajat (`extra_cost`): Elchi uni bozorga o‘tkazmadan ushlaydi — hamkor ham hisobga olishi
   * kerak (Elchi-Backend `getPartnerShipment` izohi). Rad etilgan posilkada — bizdagi rad to‘lovi (BE-21).
   */
  extraCost: number;
}

export interface ElchiShipmentsStatusResult {
  items: ElchiShipmentStatus[];
  /** Elchi topmagan (yoki boshqa hamkorniki) posilkalar. */
  notFound: string[];
  /** Vaqtincha o‘qib bo‘lmaganlar — keyingi tekshiruvda qayta. */
  failed: Array<{ shipmentId: string; error: string }>;
}

/** Farq sababi. */
export enum ElchiCheckReason {
  /** Elchi bu posilkani topmadi. */
  NOT_FOUND = 'NOT_FOUND',
  /** Elchi posilkasi boshqa buyurtmaga bog‘langan (`external_order_id`). */
  ORDER_REF = 'ORDER_REF',
  /** Holat Elchi’dagiga mos emas (masalan, Elchi «to‘landi», bizda «yetkazildi» — xabar kelmagan). */
  STATUS = 'STATUS',
  /** Elchi holati tizimga noma’lum. */
  UNKNOWN_STATUS = 'UNKNOWN_STATUS',
  /** Elchi pul o‘tkazganini aytadi, moliyada o‘tkazma yozuvi yo‘q. */
  NO_REMITTANCE = 'NO_REMITTANCE',
  /** Mijozdan yig‘ilgan summa farq qiladi (buyurtma COD si yoki yozilgan o‘tkazmadagi qiymat). */
  COLLECTED = 'COLLECTED',
  /** Elchi haqi yozilgan o‘tkazmadagidan farq qiladi. */
  FEE = 'FEE',
  /** Elchi o‘tkazgan summa yozilgan o‘tkazmadagidan farq qiladi. */
  MARKET_PAID = 'MARKET_PAID',
  /** Sotilgan posilkada Elchi qo‘shimcha xarajat yozgan — o‘tkazmadan ushlanadi, moliyada hisobga olinmagan. */
  EXTRA_COST = 'EXTRA_COST',
  /** Rad etilgan posilka: Elchi xarajati moliyadagi rad to‘lovidan farq qiladi yoki yozilmagan. */
  REFUSAL_FEE = 'REFUSAL_FEE',
}

/** Ro‘yxatdagi qator holati. */
export enum ElchiCheckItemState {
  /** Ochiq farq. */
  DIFF = 'DIFF',
  /** Farq izoh bilan yopilgan. */
  RESOLVED = 'RESOLVED',
  /** Elchi’dan o‘qib bo‘lmadi — keyingi tekshiruvda qayta. */
  FAILED = 'FAILED',
}

export class ElchiCheckRunDto {
  @ApiProperty({ example: '41' })
  id: string;

  @ApiProperty({
    example: '2026-12-03',
    description: 'Tekshiruv kuni (Toshkent)',
  })
  date: string;

  @ApiProperty({ enum: ['CRON', 'MANUAL'], example: 'CRON' })
  trigger: 'CRON' | 'MANUAL';

  @ApiProperty({ example: '2026-12-03T05:00:00.000Z', format: 'date-time' })
  startedAt: Date;

  @ApiProperty({
    example: '2026-12-03T05:00:42.000Z',
    format: 'date-time',
    nullable: true,
    type: String,
    description: 'Tugamagan (yoki yiqilgan) — null',
  })
  finishedAt: Date | null;

  @ApiProperty({ example: 312, description: 'Tekshirilgan posilkalar' })
  checked: number;

  @ApiProperty({ example: 307, description: 'Mos — ro‘yxatga chiqmaydi' })
  matched: number;

  @ApiProperty({ example: 3, description: 'Ochiq farqlar' })
  diffCount: number;

  @ApiProperty({
    example: 1,
    description:
      'Izoh bilan yopilgan farqlar: moliya yopgani va oldingi tekshiruvda yopilgan xuddi shu farq (izoh ko‘chadi)',
  })
  resolvedCount: number;

  @ApiProperty({
    example: 1,
    description: 'Elchi’dan o‘qib bo‘lmagan (keyingi tekshiruvda qayta)',
  })
  failed: number;

  @ApiProperty({
    example: false,
    description: 'Posilkalar chegaradan ko‘p edi — bir qismi tekshirilmadi',
  })
  truncated: boolean;

  @ApiProperty({
    example: null,
    nullable: true,
    type: String,
    description:
      'Tekshiruv butunlay bajarilmadi (masalan, Elchi yoki checkout javob bermadi)',
  })
  error: string | null;

  @ApiProperty({
    example: '2026-12-03T05:00:43.000Z',
    nullable: true,
    type: String,
    format: 'date-time',
  })
  alertedAt: Date | null;
}

export class ElchiCheckResolutionDto {
  @ApiProperty({
    example: 'Elchi bilan gaplashildi — webhook qayta yuboriladi',
  })
  comment: string;

  @ApiProperty({ example: '6' })
  by: string;

  @ApiProperty({ example: '2026-12-03T07:15:00.000Z', format: 'date-time' })
  at: Date;

  @ApiProperty({
    example: false,
    description:
      'true — oldingi tekshiruvdagi xuddi shu farqning izohi (o‘zgarmagan farq qayta ochilmaydi)',
  })
  carried: boolean;
}

export class ElchiCheckItemDto {
  @ApiProperty({ example: '905' })
  id: string;

  @ApiProperty({ example: '41' })
  runId: string;

  @ApiProperty({ example: '1042' })
  orderId: string;

  @ApiProperty({ example: 'L-1042' })
  orderNumber: string;

  @ApiProperty({ example: '880113' })
  shipmentId: string;

  @ApiProperty({ enum: ElchiCheckItemState, example: ElchiCheckItemState.DIFF })
  state: ElchiCheckItemState;

  @ApiProperty({
    enum: ElchiCheckReason,
    isArray: true,
    example: [ElchiCheckReason.STATUS, ElchiCheckReason.NO_REMITTANCE],
  })
  reasons: ElchiCheckReason[];

  @ApiProperty({ enum: LeadOrderStatus, example: LeadOrderStatus.DELIVERED })
  orderStatus: LeadOrderStatus;

  @ApiProperty({
    example: 'paid',
    nullable: true,
    type: String,
    description: 'Elchi holati; topilmagan — null',
  })
  elchiStatus: string | null;

  @ApiProperty({
    example: 292000,
    description: 'Buyurtma COD si (mijozdan olinadigan)',
  })
  codAmount: number;

  @ApiProperty({
    example: 292000,
    nullable: true,
    type: Number,
    description: 'Elchi: mijozdan yig‘ilgan',
  })
  elchiCollected: number | null;

  @ApiProperty({
    example: 25000,
    nullable: true,
    type: Number,
    description: 'Elchi: haqi',
  })
  elchiFee: number | null;

  @ApiProperty({
    example: 267000,
    nullable: true,
    type: Number,
    description: 'Elchi: bizga o‘tkazgani',
  })
  elchiMarketPaid: number | null;

  @ApiProperty({
    example: 0,
    nullable: true,
    type: Number,
    description:
      'Elchi: kuryer qo‘shimcha xarajati (o‘tkazmadan ushlanadi; rad etilganda — rad to‘lovi)',
  })
  elchiExtraCost: number | null;

  @ApiProperty({
    example: null,
    nullable: true,
    type: Number,
    description:
      'Moliyada yozilgan o‘tkazma (Elchi webhooki): mijozdan yig‘ilgan; yozuv yo‘q — null',
  })
  recordedCollected: number | null;

  @ApiProperty({ example: null, nullable: true, type: Number })
  recordedFee: number | null;

  @ApiProperty({ example: null, nullable: true, type: Number })
  recordedMarketPaid: number | null;

  @ApiProperty({
    example: null,
    nullable: true,
    type: Number,
    description: 'Moliyada yozilgan rad to‘lovi (Elchi webhooki)',
  })
  recordedRefusalFee: number | null;

  @ApiProperty({
    example: null,
    nullable: true,
    type: String,
    description: 'FAILED da — xato matni',
  })
  error: string | null;

  @ApiProperty({ type: ElchiCheckResolutionDto, nullable: true })
  resolution: ElchiCheckResolutionDto | null;

  @ApiProperty({ example: '2026-12-03T05:00:40.000Z', format: 'date-time' })
  checkedAt: Date;
}

export class ElchiCheckItemPageDto {
  @ApiProperty({
    type: ElchiCheckRunDto,
    nullable: true,
    description: 'Qaysi tekshiruv ko‘rsatilmoqda',
  })
  run: ElchiCheckRunDto | null;

  @ApiProperty({ type: [ElchiCheckItemDto] })
  items: ElchiCheckItemDto[];

  @ApiProperty({ example: 3 })
  total: number;

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 20 })
  limit: number;

  @ApiProperty({ example: 1 })
  totalPages: number;
}

export class ElchiCheckQueryDto {
  @ApiPropertyOptional({
    example: '2026-12-03',
    description:
      'Kun (Toshkent) — o‘sha kunning oxirgi tekshiruvi; bo‘sh — eng oxirgi tekshiruv',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date: YYYY-MM-DD' })
  date?: string;
}

export class ElchiCheckItemsQueryDto extends ElchiCheckQueryDto {
  @ApiPropertyOptional({
    example: '41',
    description: 'Aniq tekshiruv (bo‘lsa `date` e’tiborsiz)',
  })
  @IsOptional()
  @Matches(/^[1-9]\d{0,18}$/, { message: 'runId noto‘g‘ri' })
  runId?: string;

  @ApiPropertyOptional({ enum: ElchiCheckItemState })
  @IsOptional()
  @IsEnum(ElchiCheckItemState)
  state?: ElchiCheckItemState;

  @ApiPropertyOptional({
    example: 'L-1042',
    description: 'Buyurtma ID si, raqami yoki Elchi raqami',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  search?: string;

  @ApiPropertyOptional({ example: 1, default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100_000)
  page?: number;

  @ApiPropertyOptional({ example: 20, default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
