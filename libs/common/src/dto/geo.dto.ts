import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class RegionDto {
  @ApiProperty({ description: 'Viloyat IDsi (Elchi)', example: '1' })
  @IsString()
  id: string;

  @ApiProperty({ description: 'Viloyat nomi', example: 'Toshkent shahri' })
  @IsString()
  name: string;
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
}
