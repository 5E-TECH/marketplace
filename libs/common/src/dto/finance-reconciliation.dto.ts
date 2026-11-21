import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
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

/**
 * BE-46 (FE-19, DZ-07 «Elchi sverkasi»): Elchi o‘tkazmasi sverkasi — kunlar, posilkalar, farqni izoh bilan yopish.
 * Manba — BE-22 `finance.remittance_item` (Elchi webhooki, BE-21). Bir buyurtmaning farqi buyurtma bo‘yicha
 * hisoblanadi, shuning uchun ro‘yxatda har buyurtma kun ichidagi oxirgi o‘tkazma qatori bilan chiqadi.
 */
export const FINANCE_RECONCILIATION_RPC = {
  DAYS: 'finance.reconciliation.days',
  ITEMS: 'finance.reconciliation.items',
  RESOLVE: 'finance.reconciliation.resolve',
} as const;

/** Ko‘rinish holati (DZ-07 tablari): Farq bor, Hal qilindi, Mos, Kutilmoqda. */
export enum RemittanceViewState {
  DIFF = 'DIFF',
  RESOLVED = 'RESOLVED',
  MATCHED = 'MATCHED',
  PENDING = 'PENDING',
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export class RemittanceDaysQueryDto {
  @ApiProperty({ example: '2027-01-11', description: 'Toshkent kuni (kiradi)' })
  @Matches(DAY)
  from: string;

  @ApiProperty({ example: '2027-01-14', description: 'Toshkent kuni (kiradi)' })
  @Matches(DAY)
  to: string;
}

export class RemittanceDayDto {
  @ApiProperty({ example: '2027-01-13' }) day: string;
  @ApiProperty({
    enum: RemittanceViewState,
    description:
      'Kun holati: ochiq farq bo‘lsa DIFF, aks holda kutilayotgan bo‘lsa PENDING, hal qilingan bo‘lsa RESOLVED, aks holda MATCHED',
  })
  state: RemittanceViewState;

  @ApiProperty({ example: 16, description: 'Buyurtmalar (posilkalar) soni' })
  orders: number;

  @ApiProperty({ example: 1 }) diffCount: number;
  @ApiProperty({ example: 1 }) resolvedCount: number;
  @ApiProperty({ example: 14 }) matchedCount: number;
  @ApiProperty({ example: 0 }) pendingCount: number;
  @ApiProperty({ example: 3303000, description: 'Yig‘ilgan (Elchi), so‘m' })
  collected: number;

  @ApiProperty({ example: 504000, description: 'Elchi haqi, so‘m' })
  elchiFee: number;

  @ApiProperty({ example: 80000, description: 'Rad to‘lovi, so‘m' })
  refusalFee: number;

  @ApiProperty({
    example: 2719000,
    description: 'Elchi hisobi: o‘tkazma (yetkazilgan) − rad to‘lovi, so‘m',
  })
  elchiTotal: number;

  @ApiProperty({
    example: 2723000,
    description:
      'Tizim hisobi: kutilgan o‘tkazma (yetkazilgan) − rad to‘lovi, so‘m',
  })
  systemTotal: number;

  @ApiProperty({
    example: -4000,
    description: 'Ochiq (hal qilinmagan) farq, so‘m: Elchi − tizim',
  })
  openDiff: number;
}

export class RemittanceItemsQueryDto {
  @ApiPropertyOptional({ example: '2027-01-13', description: 'Toshkent kuni' })
  @IsOptional()
  @Matches(DAY)
  day?: string;

  @ApiPropertyOptional({ enum: RemittanceViewState })
  @IsOptional()
  @IsEnum(RemittanceViewState)
  state?: RemittanceViewState;

  @ApiPropertyOptional({
    example: '1049',
    description: 'Buyurtma ID si yoki raqami (aniq)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  search?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ example: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class RemittanceResolutionDto {
  @ApiProperty({
    example: 'Elchi 1 kg ortiqcha hisoblagan — Elchi bilan kelishildi',
  })
  comment: string;

  @ApiProperty({ example: '17', description: 'Kim yopdi (foydalanuvchi ID)' })
  by: string;

  @ApiProperty({ example: '2027-01-14T06:20:00.000Z' }) at: Date;
}

export class RemittanceItemDto {
  @ApiProperty({ example: '311', description: 'O‘tkazma qatori ID si' })
  id: string;

  @ApiProperty({ example: '9001' }) orderId: string;
  @ApiProperty({ example: 'L-1049', nullable: true, type: String })
  orderNumber: string | null;

  @ApiProperty({ example: '55102', nullable: true, type: String })
  shipmentId: string | null;

  @ApiProperty({ example: 'paid', description: 'Elchi holati' })
  elchiStatus: string;

  @ApiProperty({
    example: 'DELIVERED',
    nullable: true,
    type: String,
    description:
      'DELIVERED — yetkazilgan (o‘tkazma), REFUSED — rad (rad to‘lovi); jurnal hali yo‘q bo‘lsa null',
  })
  kind: 'DELIVERED' | 'REFUSED' | null;

  @ApiProperty({ example: 292000, nullable: true, type: Number })
  collectedFromCustomer: number | null;

  @ApiProperty({ example: 44000, nullable: true, type: Number })
  elchiFee: number | null;

  @ApiProperty({
    example: 248000,
    nullable: true,
    type: Number,
    description: 'Elchi o‘tkazgan',
  })
  marketPaidAmount: number | null;

  @ApiProperty({ example: null, nullable: true, type: Number })
  refusalFee: number | null;

  @ApiProperty({
    example: 252000,
    nullable: true,
    type: Number,
    description: 'Tizim hisobi',
  })
  expectedAmount: number | null;

  @ApiProperty({
    example: -4000,
    nullable: true,
    type: Number,
    description:
      'Elchi − tizim, o‘tkazma ma’nosida: rad to‘lovi ko‘p ushlansa manfiy (DZ-07)',
  })
  diff: number | null;

  @ApiProperty({
    example: 'MISMATCH',
    description: 'BE-22 holati: PENDING, MATCHED, PARTIAL, MISMATCH',
  })
  matchState: string;

  @ApiProperty({ enum: RemittanceViewState }) state: RemittanceViewState;
  @ApiProperty({ example: '2027-01-13T11:05:00.000Z' }) receivedAt: Date;
  @ApiProperty({ type: RemittanceResolutionDto, nullable: true })
  resolution: RemittanceResolutionDto | null;
}

export class RemittanceItemPageDto {
  @ApiProperty({ type: [RemittanceItemDto] }) items: RemittanceItemDto[];
  @ApiProperty({ example: 16 }) total: number;
  @ApiProperty({ example: 1 }) page: number;
  @ApiProperty({ example: 10 }) limit: number;
  @ApiProperty({ example: 2 }) totalPages: number;
}

export class ResolveRemittanceDto {
  @ApiProperty({
    example: 'Elchi 1 kg ortiqcha hisoblagan — Elchi bilan kelishildi',
    description: 'Izoh majburiy (FE-19 TC2)',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  comment: string;
}
