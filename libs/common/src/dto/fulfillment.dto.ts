import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Ombor: yig‘ish, qadoq, yorliq va Elchi’ga topshirish (BE-19; TZ 6.6 OMB-2, OMB-4, OMB-5; T4 `fulfillment_task`).
 */

/** Yig‘ish vazifasi holati (TZ T4); bekor qilingan buyurtmada — CANCELLED. */
export enum FulfillmentTaskStatus {
  TO_PICK = 'TO_PICK',
  PICKED = 'PICKED',
  PACKED = 'PACKED',
  HANDED_OVER = 'HANDED_OVER',
  CANCELLED = 'CANCELLED',
}

/** Posilkaning Elchi tomonidagi holati (BE-20 xabarlaridan). */
export enum ParcelElchiState {
  PENDING = 'PENDING',
  CREATED = 'CREATED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
  CANCEL_FAILED = 'CANCEL_FAILED',
}

/** OMB-4: shu vaqtgacha (Toshkent) tasdiqlangan buyurtma o‘sha kuni jo‘natiladi. */
export const PICK_CUTOFF_HOUR = 14;
const TASHKENT = 'Asia/Tashkent';

/** Toshkent bo‘yicha sana (YYYY-MM-DD). */
export function tashkentDate(at: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TASHKENT,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/**
 * Yig‘ish kuni (OMB-4, TC1): 14:00 gacha (Toshkent) tasdiqlangan — o‘sha kun, keyin — ertasi kalendar kuni [taklif:
 * Elchi dam olish kunlari EQ-06/EQ-07 dan keyin].
 */
export function pickDateFor(confirmedAt: Date): string {
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: TASHKENT,
      hour: '2-digit',
      hourCycle: 'h23',
    }).format(confirmedAt),
  );
  if (hour < PICK_CUTOFF_HOUR) return tashkentDate(confirmedAt);
  const [y, m, d] = tashkentDate(confirmedAt).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

/** Ichki RPC nomlari (gateway → checkout). */
export const WAREHOUSE_RPC = {
  PICK_LIST: 'checkout.warehouse.pick-list',
  SCAN: 'checkout.warehouse.scan',
  PACK: 'checkout.warehouse.pack',
  LABEL: 'checkout.warehouse.label',
  HANDOVER: 'checkout.warehouse.handover',
  ACT_GET: 'checkout.warehouse.act-get',
  ACT_PDF: 'checkout.warehouse.act-pdf',
} as const;

export class WarehousePickListQueryDto {
  @ApiPropertyOptional({
    example: '2026-12-15',
    description:
      'Yig‘ish kuni (Toshkent); berilmasa — bugun. Oldingi kunlardan qolganlar ham chiqadi.',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date YYYY-MM-DD bo‘lishi kerak' })
  date?: string;
}

export class WarehouseScanDto {
  @ApiProperty({
    example: '4780012345678',
    description: 'Tovar shtrix-kodi yoki SKU',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  code: string;
}

export class WarehouseHandoverDto {
  @ApiProperty({
    type: [String],
    description: 'Skanerlangan posilka QR tokenlari (yorliqdagi QR)',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(128, { each: true })
  qrTokens: string[];
}

export interface PickListItem {
  taskId: string;
  orderId: string;
  orderNumber: string;
  status: FulfillmentTaskStatus;
  pickDate: string;
  /** Oldingi kundan qolgan. */
  overdue: boolean;
  productName: string;
  sku: string | null;
  barcode: string | null;
  quantity: number;
  pickedQty: number;
  parcel: {
    elchiState: ParcelElchiState | null;
    shipmentId: string | null;
    labelReady: boolean;
    error: string | null;
  };
}

export interface PickListPage {
  date: string;
  items: PickListItem[];
  counts: Record<'toPick' | 'picked' | 'packed' | 'overdue', number>;
  truncated: boolean;
}

export interface HandoverActView {
  id: string;
  parcelCount: number;
  createdBy: string;
  createdAt: string;
  items: Array<{
    parcelId: string;
    orderId: string;
    orderNumber: string;
    shipmentId: string;
    qrCodeToken: string;
  }>;
}
