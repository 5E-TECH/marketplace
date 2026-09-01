import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export const ELCHI_WEBHOOK_STATUSES = [
  'shipment_created',
  'on_the_road',
  'delivered',
  'sold',
  'cancelled',
  'canceled',
  'returned',
  'settled',
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

  @ApiProperty({ example: '55' })
  @Matches(/^[1-9]\d*$/)
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
}

export interface ReturnOrderItemsDto {
  orderRef: string;
  items: Array<{ variantId: string; quantity: number }>;
  idempotencyKey: string;
  reason: string;
}
