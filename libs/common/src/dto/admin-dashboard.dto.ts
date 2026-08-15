import { ApiProperty } from '@nestjs/swagger';

/**
 * C1.28 — Admin platforma dashboard'i. Gateway uch servisdan (catalog/identity/
 * checkout) parallel yig'adi. Yangi platformada barcha son 0 (xato emas).
 */
export class AdminDashboardShopsDto {
  @ApiProperty({ example: 12 }) total: number;
  @ApiProperty({ example: 3 }) pending: number;
  @ApiProperty({ example: 8 }) active: number;
  @ApiProperty({ example: 1 }) suspended: number;
  @ApiProperty({ example: 0 }) rejected: number;
}

export class AdminDashboardUsersDto {
  @ApiProperty({ example: 40 }) total: number;
  @ApiProperty({ example: 12 }) sellers: number;
  @ApiProperty({ example: 25 }) buyers: number;
  @ApiProperty({ example: 2 }) admins: number;
  @ApiProperty({ example: 1 }) operators: number;
}

export class AdminDashboardOrdersDto {
  @ApiProperty({ example: 320 }) total: number;
  @ApiProperty({ example: 7 }) today: number;
}

export class AdminDashboardDto {
  @ApiProperty({ type: AdminDashboardShopsDto }) shops: AdminDashboardShopsDto;
  @ApiProperty({ type: AdminDashboardUsersDto }) users: AdminDashboardUsersDto;
  @ApiProperty({ type: AdminDashboardOrdersDto })
  orders: AdminDashboardOrdersDto;

  /** Umumiy aylanma — tasdiqlangan buyurtmalar summasi (sum of total_amount). */
  @ApiProperty({ example: 54000000 }) gmv: number;

  /** Platforma daromadi = GMV × komissiya foizi (PLATFORM_COMMISSION_RATE). */
  @ApiProperty({ example: 2700000 }) revenue: number;
}
