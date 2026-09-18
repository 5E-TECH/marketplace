import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class RegionDto {
  @ApiProperty({ description: 'Viloyat IDsi (Elchi)', example: '1' })
  @IsString()
  id: string;

  @ApiProperty({ description: 'Viloyat nomi', example: 'Toshkent shahri' })
  @IsString()
  name: string;

  @ApiProperty({ description: 'SOATO/SATO kodi', example: '1726266' })
  @IsString()
  satoCode: string;
}

export class DistrictDto {
  @ApiProperty({ description: 'Tuman IDsi (Elchi)', example: '10' })
  @IsString()
  id: string;

  @ApiProperty({ description: 'Viloyat IDsi (Elchi)', example: '1' })
  @IsString()
  regionId: string;

  @ApiProperty({ description: 'Tuman nomi', example: 'Yunusobod tumani' })
  @IsString()
  name: string;

  @ApiProperty({ description: 'SOATO/SATO kodi', example: '1726266' })
  @IsString()
  satoCode: string;
}

export class GeoSyncResultDto {
  @ApiProperty({ example: 14 }) regions: number;
  @ApiProperty({ example: 181 }) districts: number;
  @ApiProperty({ example: 2 }) added: number;
  @ApiProperty({ example: 3 }) updated: number;
  @ApiProperty({ example: 1 }) deleted: number;
}

export class MarketTariffSyncResultDto {
  @ApiProperty({ example: 7 }) total: number;
  @ApiProperty({ example: 7 }) updated: number;
  @ApiProperty({ example: 0 }) failed: number;
}
