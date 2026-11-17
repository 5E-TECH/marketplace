import { Controller, Get, Inject, Param } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  DistrictDto,
  LeadRegionGroupDto,
  Public,
  RegionDto,
  RmqClient,
  sendRpc,
} from '@app/common';
import { notImplementedYet } from '../leads/lead-stub';

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

  @Get('tree')
  @ApiOperation({
    summary: 'Viloyatlar va tumanlar bitta ro‘yxatda (SOATO bo‘yicha)',
    description:
      'JS o‘chiq formadagi guruhlangan «Tuman yoki shahar» ro‘yxati uchun (BE-38, ega javobi 2026-11-16). ' +
      'Elchi bormaydigan tumanlar ro‘yxatda yo‘q.',
  })
  @ApiOkResponse({ type: [LeadRegionGroupDto] })
  getRegionTree(): Promise<LeadRegionGroupDto[]> {
    return notImplementedYet('BE-38');
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
