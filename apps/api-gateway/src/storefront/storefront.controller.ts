import {
  Controller,
  Get,
  Inject,
  Param,
  ParseIntPipe,
  Query,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  AuthErrorResponseDto,
  Public,
  RmqClient,
  sendRpc,
  StorefrontProductDto,
  StorefrontProductsPageDto,
  StorefrontProductsQueryDto,
  StorefrontShopPageDto,
} from '@app/common';

@ApiTags('storefront')
@Public()
@Controller('storefront')
export class StorefrontController {
  constructor(
    @Inject(RmqClient.CATALOG) private readonly catalog: ClientProxy,
  ) {}

  @Get('products')
  @ApiOperation({ summary: 'Faol mahsulotlar ochiq katalogi' })
  @ApiOkResponse({ type: StorefrontProductsPageDto })
  listProducts(@Query() query: StorefrontProductsQueryDto) {
    return sendRpc(this.catalog, { cmd: 'storefront.products.list' }, query);
  }

  @Get('products/:id')
  @ApiOperation({ summary: 'Faol mahsulot tafsiloti' })
  @ApiOkResponse({ type: StorefrontProductDto })
  @ApiNotFoundResponse({ type: AuthErrorResponseDto })
  getProduct(@Param('id', ParseIntPipe) id: number) {
    return sendRpc(
      this.catalog,
      { cmd: 'storefront.products.get' },
      { id: String(id) },
    );
  }

  @Get('shops/:shopId/products')
  @ApiOperation({
    summary: 'Faol do‘kon mahsulotlarini ID bo‘yicha olish',
  })
  @ApiOkResponse({ type: StorefrontProductsPageDto })
  @ApiNotFoundResponse({ type: AuthErrorResponseDto })
  getShopProducts(
    @Param('shopId', ParseIntPipe) shopId: number,
    @Query() query: StorefrontProductsQueryDto,
  ) {
    return sendRpc(
      this.catalog,
      { cmd: 'storefront.shops.products.list' },
      { shopId: String(shopId), query },
    );
  }

  @Get('shops/:slug')
  @ApiOperation({ summary: 'Faol do‘kon sahifasi va mahsulotlari' })
  @ApiOkResponse({ type: StorefrontShopPageDto })
  @ApiNotFoundResponse({ type: AuthErrorResponseDto })
  getShop(
    @Param('slug') slug: string,
    @Query() query: StorefrontProductsQueryDto,
  ) {
    return sendRpc(
      this.catalog,
      { cmd: 'storefront.shops.get' },
      { slug, query },
    );
  }
}
