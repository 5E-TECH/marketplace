import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';

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
  @ApiProperty({
    example: 'Smartfon X 128GB',
    description:
      'Savatga qo‘shilgan paytdagi nom (narx kabi surat) — buyurtmaga ham shu nom o‘tadi',
  })
  productName: string;
  @ApiProperty({
    type: String,
    example: 'https://api.elchimarket.uz/media/products/35/main.webp',
    nullable: true,
    description:
      'Variant rasmi, u bo‘lmasa mahsulotning asosiy rasmi. Katalogdan jonli olinadi',
  })
  imageUrl: string | null;
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
  /**
   * Katalogdagi mahsulot nomi. Savatga qo'shilganda suratga olinadi va
   * buyurtmaga o'tadi — Elchi posilka yaratishda BO'SH nomni rad etadi
   * ("items.0.name should not be empty").
   */
  productName: string;
}

export enum CheckoutPaymentMethod {
  ONLINE = 'online',
  COD = 'cod',
}

/** Elchi posilkasi uy manziliga yoki topshirish markaziga yetkaziladi. */
export enum CheckoutDeliveryDestination {
  ADDRESS = 'ADDRESS',
  CENTER = 'CENTER',
}

export class CheckoutAddressDto {
  @ApiProperty({ example: 'Dilshodbek Aliyev' })
  @IsString()
  recipientName: string;

  @ApiProperty({ example: '+998901234567' })
  @Matches(/^\+998\d{9}$/, {
    message: "phone +998XXXXXXXXX formatida bo'lishi kerak",
  })
  phone: string;

  @ApiProperty({ example: 'Toshkent shahri, Amir Temur ko‘chasi 1' })
  @IsString()
  address: string;

  @ApiPropertyOptional({ example: '10' })
  @IsOptional()
  @IsString()
  regionId?: string;

  @ApiPropertyOptional({ example: '101' })
  @IsOptional()
  @IsString()
  districtId?: string;

  @ApiPropertyOptional({
    enum: CheckoutDeliveryDestination,
    default: CheckoutDeliveryDestination.ADDRESS,
    description: 'ADDRESS — uyga, CENTER — Elchi markaziga yetkazish',
  })
  @IsOptional()
  @IsEnum(CheckoutDeliveryDestination)
  whereDeliver?: CheckoutDeliveryDestination =
    CheckoutDeliveryDestination.ADDRESS;
}

/** Bitta buyurtmada rasmiylashtiriladigan savat qatorlarining yuqori chegarasi. */
export const MAX_CHECKOUT_CART_ITEMS = 100;

export class DeliveryPreviewDto {
  @ApiProperty({ type: CheckoutAddressDto })
  @ValidateNested()
  @Type(() => CheckoutAddressDto)
  address: CheckoutAddressDto;

  @ApiPropertyOptional({
    type: [String],
    example: ['10', '12'],
    maxItems: MAX_CHECKOUT_CART_ITEMS,
    description:
      'Faqat shu savat qatorlari (`GET /cart` → `items[].id`). Berilmasa — ' +
      'butun savat. Buyurtmadan keyin tanlangan qatorlar savatdan o‘chadi, ' +
      'qolganlari savatda qoladi.',
  })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(MAX_CHECKOUT_CART_ITEMS)
  @ArrayUnique()
  @Matches(/^[1-9]\d{0,18}$/, {
    each: true,
    message: 'cartItemIds musbat son (savat qatori id) bo‘lishi kerak',
  })
  cartItemIds?: string[];
}

export class CreateCheckoutDto extends DeliveryPreviewDto {
  @ApiProperty({ enum: CheckoutPaymentMethod })
  @IsEnum(CheckoutPaymentMethod)
  paymentMethod: CheckoutPaymentMethod;
}

export interface DeliveryPackageQuoteDto {
  shopId: string;
  itemsCount: number;
  subtotal: number;
  deliveryFee: number;
  totalAmount: number;
}

export interface DeliveryPreviewResultDto {
  subtotal: number;
  deliveryFee: number;
  totalAmount: number;
  packages: DeliveryPackageQuoteDto[];
}

export interface CheckoutResultDto {
  id: string;
  status: 'PENDING_PAYMENT' | 'DRAFT';
  paymentMethod: CheckoutPaymentMethod;
  totalAmount: number;
  subtotal: number;
  deliveryFee: number;
  reservationId: string;
  reservationExpiresAt: string;
  sellerOrders: Array<{
    id: string;
    shopId: string;
    subtotal: number;
    deliveryFee: number;
    totalAmount: number;
    status: string;
  }>;
}

export interface CheckoutReserveInputDto {
  orderRef: string;
  items: Array<{ variantId: string; quantity: number }>;
  ttlMs: number;
  idempotencyKey: string;
}
