import { Controller, Get, Inject, Query } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  Public,
  RmqClient,
  SearchProductsPageDto,
  SearchProductsQueryDto,
  sendRpc,
} from '@app/common';

@ApiTags('storefront')
@Public()
@Controller('storefront/search')
export class SearchController {
  constructor(@Inject(RmqClient.SEARCH) private readonly search: ClientProxy) {}

  @Get()
  @ApiOperation({
    summary: 'Mahsulotlarni relevantlik va facetlar bilan qidirish',
  })
  @ApiOkResponse({ type: SearchProductsPageDto })
  products(@Query() query: SearchProductsQueryDto) {
    return sendRpc(this.search, { cmd: 'search.products' }, query);
  }
}
