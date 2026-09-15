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

export class BuyerOrderItemDto {
  @ApiProperty({ example: '88' }) productId: string;
  @ApiProperty({ example: 'Telefon' }) productName: string;
  @ApiProperty({ example: '5' }) variantId: string;
  @ApiProperty({ example: 2 }) quantity: number;
  @ApiProperty({ example: 225000 }) unitPrice: number;
  @ApiProperty({ example: 450000 }) lineTotal: number;
}

export class BuyerOrderShopDto {
  @ApiProperty({ example: '31' }) id: string;
  @ApiProperty({ example: '15' }) shopId: string;
  @ApiProperty({ example: 450000 }) subtotal: number;
  @ApiProperty({ example: 25000 }) deliveryFee: number;
  @ApiProperty({ example: 'ON_THE_ROAD' }) status: string;
  @ApiPropertyOptional({ example: '987', nullable: true })
  elchiShipmentId: string | null;
  @ApiPropertyOptional({
    example: 'https://elchi.uz/track/987',
    nullable: true,
  })
  trackingUrl: string | null;
  @ApiProperty({ type: [BuyerOrderItemDto] }) items: BuyerOrderItemDto[];
}

export class BuyerOrderDetailsDto {
  @ApiProperty({ example: '42' }) id: string;
  @ApiPropertyOptional({ example: 'Ali', nullable: true }) buyerName:
    string | null;
  @ApiProperty({ example: 'CONFIRMED' }) status: string;
  @ApiProperty({ example: 'cod' }) paymentMethod: string;
  @ApiProperty({ example: 475000 }) totalAmount: number;
  @ApiProperty({ example: 25000 }) deliveryFee: number;
  @ApiPropertyOptional({ example: 'Toshkent, Amir Temur 1', nullable: true })
  deliveryAddress: string | null;
  @ApiProperty({ example: '2026-09-14T10:00:00.000Z' })
  createdAt: Date | string;
  @ApiProperty({ example: '2026-09-14T10:30:00.000Z' })
  updatedAt: Date | string;
  @ApiProperty({ type: [BuyerOrderShopDto] }) sellerOrders: BuyerOrderShopDto[];
}
