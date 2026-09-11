import { Controller, Get, Inject, Param } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  DistrictDto,
  Public,
  RegionDto,
  RmqClient,
  sendRpc,
} from '@app/common';

@ApiTags('regions')
@Public()
@Controller('regions')
export class RegionsController {
  constructor(
    @Inject(RmqClient.INTEGRATION) private readonly integration: ClientProxy,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Viloyatlar ro‘yxati (checkout va do‘kon manzili uchun)',
  })
  @ApiOkResponse({ type: [RegionDto] })
  getRegions(): Promise<RegionDto[]> {
    return sendRpc(this.integration, { cmd: 'integration.regions.list' }, {});
  }

  @Get(':regionId/districts')
  @ApiOperation({ summary: 'Tanlangan viloyat tumanlari ro‘yxati' })
  @ApiOkResponse({ type: [DistrictDto] })
  getDistricts(@Param('regionId') regionId: string): Promise<DistrictDto[]> {
    return sendRpc(
      this.integration,
      { cmd: 'integration.districts.list' },
      { regionId },
    );
  }
}
