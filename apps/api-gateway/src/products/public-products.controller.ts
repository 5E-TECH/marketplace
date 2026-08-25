import { Controller, Get, Inject, Query } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  Public,
  RmqClient,
  sendRpc,
  StorefrontProductsPageDto,
  StorefrontProductsQueryDto,
} from '@app/common';
@ApiTags('products')
@Public()
@Controller('products')
export class PublicProductsController {
  constructor(
    @Inject(RmqClient.CATALOG) private readonly catalog: ClientProxy,
  ) {}
  @Get()
  @ApiOperation({ summary: 'Uzum uslubidagi barcha faol mahsulotlar' })
  @ApiOkResponse({ type: StorefrontProductsPageDto })
  all(@Query() query: StorefrontProductsQueryDto) {
    return sendRpc(this.catalog, { cmd: 'storefront.products.list' }, query);
  }
}
