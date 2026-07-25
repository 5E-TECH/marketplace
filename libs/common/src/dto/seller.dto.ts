import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Role, ShopStatus } from '../enums';

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
