import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class BuyerShipmentTrackingDto {
  @ApiProperty({ example: '7' })
  shipmentId: string;

  @ApiProperty({ example: '3' })
  shopId: string;

  @ApiProperty({ example: 'Elchi do‘koni' })
  shopName: string;

  @ApiProperty({ example: 'OUT_FOR_DELIVERY' })
  shipmentStatus: string;

  @ApiPropertyOptional({ example: 'https://elchi.uz/track/7', nullable: true })
  trackingUrl: string | null;

  @ApiProperty({ example: '2026-09-14T10:30:00.000Z' })
  updatedAt: Date | string;
}

export class BuyerOrderTrackingDto {
  @ApiProperty({ example: '42' })
  orderId: string;

  @ApiProperty({ example: 'IN_TRANSIT' })
  orderStatus: string;

  @ApiPropertyOptional({
    example: '2026-09-16T12:00:00.000Z',
    nullable: true,
    description:
      'Yetkazish provayderi bergan taxminiy vaqt; mavjud bo‘lmasa null',
  })
  estimatedDeliveryAt: Date | string | null;

  @ApiProperty({ example: '2026-09-14T10:30:00.000Z' })
  updatedAt: Date | string;

  @ApiProperty({ type: [BuyerShipmentTrackingDto] })
  shipments: BuyerShipmentTrackingDto[];
}
