import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNumber, IsString, Matches, Max, Min } from 'class-validator';

/** C6.2 — panel orqali boshqariladigan platforma sozlamalari. */
export class UpdateAdminSettingsDto {
  @ApiProperty({ example: 5, minimum: 0, maximum: 100 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  commissionPercent: number;

  @ApiProperty({ example: 50000, minimum: 0 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(999999999999.99)
  minimumOrderAmount: number;

  @ApiProperty({
    example: '+998712000000',
    description: "Bo'sh yoki +998XXXXXXXXX",
  })
  @IsString()
  @Matches(/^(?:|\+998\d{9})$/)
  supportPhone: string;
}

export class AdminSettingsDto extends UpdateAdminSettingsDto {
  @ApiProperty({ example: '17' })
  updatedBy: string | null;

  @ApiProperty({ example: '2026-09-08T12:00:00.000Z' })
  updatedAt: Date;
}
