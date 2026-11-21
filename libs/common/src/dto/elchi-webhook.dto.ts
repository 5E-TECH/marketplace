import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export const ELCHI_WEBHOOK_STATUSES = [
  'shipment_created',
  'received',
  'on_the_road',
  'delivered',
  'sold',
  'cancelled',
  'canceled',
  'returned',
  'settled',
  // BE-21 (TZ T9-7): pul holatlari endi tashlab yuborilmaydi
  'paid',
  'partly_paid',
  'closed',
] as const;

export class ElchiWebhookDto {
  @ApiProperty({ example: 'evt_123' })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  eventId: string;

  @ApiProperty({ example: 'shipment.status_changed' })
  @IsString()
  @IsIn(['shipment.status_changed', 'shipment.settled'])
  type: string;

  @ApiProperty({ example: '77012' })
  @Matches(/^[1-9]\d*$/)
  shipmentId: string;

  @ApiProperty({
    example: 'mp-order:55',
    description:
      'Lid buyurtmasi — `mp-order:<buyurtma>` (BE-20); eski do‘kon buyurtmasi — posilka raqami',
  })
  @Matches(/^(mp-order:)?[1-9]\d{0,18}$/)
  externalOrderId: string;

  @ApiProperty({ enum: ELCHI_WEBHOOK_STATUSES, example: 'sold' })
  @IsIn(ELCHI_WEBHOOK_STATUSES)
  status: (typeof ELCHI_WEBHOOK_STATUSES)[number];

  @ApiPropertyOptional({ example: 499000 })
  @IsOptional()
  @IsNumber()
  codCollected?: number;

  @ApiProperty({ example: '2026-08-27T08:00:00.000Z' })
  @IsDateString()
  occurredAt: string;

  // BE-21 (TZ ELC-4, T9-7): Elchi pul maydonlari — butun so‘m.

  @ApiPropertyOptional({
    example: 499000,
    description: 'Kuryer mijozdan yig‘gan naqd (`collected_from_customer`)',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  collectedFromCustomer?: number;

  @ApiPropertyOptional({
    example: 449000,
    description:
      'Elchi marketga shu paytgacha to‘lagan jami (`market_paid_amount`, snapshot)',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  marketPaidAmount?: number;

  @ApiPropertyOptional({
    example: 50000,
    description: 'Elchi haqi (`elchi_fee`)',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  elchiFee?: number;

  @ApiPropertyOptional({
    example: 20000,
    description:
      'Kuryer yozgan qo‘shimcha xarajat (`extra_cost`), masalan bekor qilishda',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  extraCost?: number;
}

/**
 * checkout → notification (BE-21): Elchi xabari buyurtma holatiga zid — masalan, yetkazilgan sotuvni bekor qildi,
 * rad etilgan posilkani «sotildi» dedi yoki akt yopilmagan buyurtmaga «to‘landi» yubordi. Buyurtma «faqat oldinga»
 * qoidasi bilan o‘zgarmaydi — moliya va nazoratchi qo‘lda hal qiladi. Bir buyurtma uchun bir marta.
 */
export const ELCHI_STATUS_CONFLICT_EVENT = 'elchi.status.conflict';

export interface ElchiStatusConflictEvent {
  orderId: string;
  shipmentId: string;
  orderStatus: string;
  elchiStatus: string;
  eventId: string;
  occurredAt: string;
}

export interface ReturnOrderItemsDto {
  orderRef: string;
  items: Array<{ variantId: string; quantity: number }>;
  idempotencyKey: string;
  reason: string;
}
