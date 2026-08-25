import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { Role, SalesOrderSellerStatus, ShopStatus } from '../enums';

export class SellerRegisterDto {
  @ApiProperty({ example: 'Ali Valiyev' })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name: string;

  @ApiProperty({ example: '+998901234567' })
  @Matches(/^\+998\d{9}$/, {
    message: "phone +998XXXXXXXXX formatida bo'lishi kerak",
  })
  phone: string;

  @ApiProperty({ example: 'Secret123', minLength: 8 })
  @IsString()
  @MinLength(8)
  password: string;

  @ApiPropertyOptional({ example: 'seller@example.com' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiProperty({ example: 'Ali Market' })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  shopName: string;

  @ApiPropertyOptional({ example: 'Maishiy texnika do‘koni' })
  @IsOptional()
  @IsString()
  shopDescription?: string;

  @ApiPropertyOptional({ example: 'Toshkent shahri, Chilonzor tumani' })
  @IsOptional()
  @IsString()
  address?: string;
}

export class SellerRegisterResponseDto {
  @ApiProperty({ example: 201 }) statusCode: number;
  @ApiProperty({ example: 'OK' }) message: string;
  @ApiProperty({
    example: {
      user: {
        id: '42',
        name: 'Ali Valiyev',
        phone: '+998901234567',
        role: Role.SELLER,
        isActive: false,
      },
      shop: {
        id: '15',
        name: 'Ali Market',
        slug: 'ali-market-1234567',
        status: ShopStatus.PENDING,
      },
    },
  })
  data: object;
}

export class UpdateSellerShopDto {
  @ApiPropertyOptional({ example: 'Ali Market' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name?: string;

  @ApiPropertyOptional({ example: 'Maishiy texnika do‘koni' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: 'https://cdn.example.com/logo.png' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  logoUrl?: string;

  @ApiPropertyOptional({ example: 'https://cdn.example.com/banner.png' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  bannerUrl?: string;

  @ApiPropertyOptional({ example: '+998901234567' })
  @IsOptional()
  @Matches(/^\+998\d{9}$/, {
    message: "phone +998XXXXXXXXX formatida bo'lishi kerak",
  })
  phone?: string;

  @ApiPropertyOptional({ example: '1' })
  @IsOptional()
  @IsString()
  regionId?: string;

  @ApiPropertyOptional({ example: '10' })
  @IsOptional()
  @IsString()
  districtId?: string;

  @ApiPropertyOptional({ example: 'Toshkent shahri, Chilonzor tumani' })
  @IsOptional()
  @IsString()
  address?: string;
}

export class SellerShopDto {
  @ApiProperty({ example: '15' })
  id: string;

  @ApiProperty({ example: '42' })
  ownerUserId: string;

  @ApiProperty({ example: 'Ali Market' })
  name: string;

  @ApiProperty({ example: 'ali-market-1234567' })
  slug: string;

  @ApiProperty({ enum: ShopStatus, example: ShopStatus.PENDING })
  status: ShopStatus;

  @ApiProperty({ example: 'Maishiy texnika do‘koni', nullable: true })
  description: string | null;

  @ApiProperty({ example: null, nullable: true, type: String })
  logoUrl: string | null;

  @ApiProperty({ example: null, nullable: true, type: String })
  bannerUrl: string | null;

  @ApiProperty({ example: '+998901234567', nullable: true })
  phone: string | null;

  @ApiProperty({ example: '1', nullable: true })
  regionId: string | null;

  @ApiProperty({ example: '10', nullable: true })
  districtId: string | null;

  @ApiProperty({ example: 'Toshkent shahri', nullable: true })
  address: string | null;

  @ApiProperty({ example: 0 })
  rating: number;

  @ApiProperty({ example: 0 })
  ordersCount: number;
}

export class SellerShopResponseDto {
  @ApiProperty({ example: 200 })
  statusCode: number;

  @ApiProperty({ example: 'OK' })
  message: string;

  @ApiProperty({ type: SellerShopDto })
  data: SellerShopDto;
}

export class SellerOrdersQueryDto {
  @ApiPropertyOptional({ enum: SalesOrderSellerStatus })
  @IsOptional()
  @IsEnum(SalesOrderSellerStatus)
  status?: SalesOrderSellerStatus;

  @ApiPropertyOptional({ example: '2026-07-01' })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional({ example: '2026-07-31' })
  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @ApiPropertyOptional({ example: '123' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  search?: string;

  @ApiPropertyOptional({ example: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ example: 20, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}

export class UpdateSellerOrderStatusDto {
  @ApiProperty({ enum: SalesOrderSellerStatus })
  @IsEnum(SalesOrderSellerStatus)
  status: SalesOrderSellerStatus;
}

export class CreateShipmentDto {
  @ApiPropertyOptional({ example: '+998901112233' })
  @IsOptional()
  @Matches(/^\+998\d{9}$/)
  customerPhone?: string;
}

export class SellerOrderItemDto {
  @ApiProperty({ example: '31' })
  id: string;

  @ApiProperty({ example: '12' })
  salesOrderId: string;

  @ApiProperty({ example: 'Ali Valiyev', nullable: true })
  buyerName: string | null;

  @ApiProperty({ example: 450000 })
  subtotal: number;

  @ApiProperty({ example: 450000 })
  codAmount: number;

  @ApiProperty({ enum: SalesOrderSellerStatus })
  status: SalesOrderSellerStatus;

  @ApiProperty({ example: '987', nullable: true })
  elchiShipmentId: string | null;

  @ApiProperty({ example: 'https://elchi.uz/track/987', nullable: true })
  trackingUrl: string | null;

  @ApiProperty({ example: 2 })
  itemsCount: number;

  @ApiProperty({ example: '2026-07-30T09:00:00.000Z' })
  createdAt: Date;
}

export class SellerOrdersPageDto {
  @ApiProperty({ type: [SellerOrderItemDto] })
  items: SellerOrderItemDto[];

  @ApiProperty({ example: 42 })
  total: number;

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 20 })
  limit: number;

  @ApiProperty({ example: 3 })
  totalPages: number;
}

export class SellerDashboardDto {
  @ApiProperty({ example: 42 })
  ordersTotal: number;

  @ApiProperty({ example: 5400000 })
  revenue: number;

  @ApiProperty({ example: 3 })
  pendingShipments: number;

  @ApiProperty({ example: 30 })
  delivered: number;

  @ApiProperty({ example: 5 })
  lowStockCount: number;

  @ApiProperty({
    example: [{ productId: '88', name: 'Telefon', sold: 21 }],
  })
  topProducts: Array<{ productId: string; name: string; sold: number }>;

  @ApiProperty({
    example: [{ date: '2026-07-20', amount: 320000 }],
  })
  salesByDay: Array<{ date: string; amount: number }>;
}
