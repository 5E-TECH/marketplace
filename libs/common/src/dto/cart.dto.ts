import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsString, Min } from 'class-validator';

export class AddCartItemDto {
  @ApiProperty({ example: '35' })
  @IsString()
  productId: string;

  @ApiProperty({ example: '42' })
  @IsString()
  variantId: string;

  @ApiPropertyOptional({ example: 1, default: 1, minimum: 1 })
  @IsInt()
  @Min(1)
  quantity = 1;
}

export class UpdateCartItemDto {
  @ApiProperty({ example: 2, minimum: 1 })
  @IsInt()
  @Min(1)
  quantity: number;
}

export class CartItemDto {
  @ApiProperty({ example: '10' }) id: string;
  @ApiProperty({ example: '35' }) productId: string;
  @ApiProperty({ example: '42' }) variantId: string;
  @ApiProperty({ example: '7' }) shopId: string;
  @ApiProperty({ example: 2 }) quantity: number;
  @ApiProperty({ example: 125000 }) unitPriceSnapshot: number;
  @ApiProperty({ example: 250000 }) lineTotal: number;
}

export class CartDto {
  @ApiProperty({ example: '5', nullable: true }) id: string | null;
  @ApiProperty({ example: '9', nullable: true }) customerId: string | null;
  @ApiProperty({ example: 'browser-session', nullable: true }) sessionId:
    string | null;
  @ApiProperty({ type: [CartItemDto] }) items: CartItemDto[];
  @ApiProperty({ example: 250000 }) totalAmount: number;
  @ApiProperty({ example: 2 }) totalQuantity: number;
}

export interface CartOwnerDto {
  customerId?: string;
  sessionId?: string;
}

export interface CartCatalogVariantDto {
  productId: string;
  variantId: string;
  shopId: string;
  unitPrice: number;
}
