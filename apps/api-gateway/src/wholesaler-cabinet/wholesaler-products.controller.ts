import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  CreateProductDto,
  CurrentUser,
  JwtUser,
  RmqClient,
  Role,
  Roles,
  sendRpc,
  WHOLESALER_CABINET_RPC as RPC,
  WholesalerPricingQueryDto,
  WholesalerProductsQueryDto,
} from '@app/common';
import { WHOLESALER_PRICING_EXAMPLE } from '../admin/admin-pricing.examples';
import { ParseLeadIdPipe } from '../leads/lead-id.pipe';
import {
  WHOLESALER_PRODUCT_EXAMPLE,
  WHOLESALER_PRODUCTS_PAGE_EXAMPLE,
} from './wholesaler.examples';

/**
 * BE-30 (OPT-2, NRX-2): optovik mahsulot taklif qiladi — admin tasdiqlamaguncha sotuvga chiqmaydi (PENDING_REVIEW);
 * shartnomasiz — 403 (TC1). Narx hisobi faqat o‘z mahsulotiga (TC6); boshqa optovikniki — 403.
 */
@ApiTags('wholesaler')
@ApiBearerAuth()
@Roles(Role.WHOLESALER)
@Controller('wholesaler/products')
export class WholesalerProductsController {
  constructor(
    @Inject(RmqClient.CATALOG) private readonly catalog: ClientProxy,
  ) {}

  @Post()
  @ApiOperation({
    summary:
      'Mahsulot taklifi: nom, tavsif, rasm, og‘irlik va o‘lcham, bazaviy narx (sertifikat — /wholesaler/documents)',
  })
  @ApiCreatedResponse({
    description:
      'Taklif qilingan mahsulot — admin tasdig‘igacha PENDING_REVIEW (sotuvga chiqmaydi)',
    schema: { example: WHOLESALER_PRODUCT_EXAMPLE },
  })
  @ApiForbiddenResponse({
    description:
      'Komissiya shartnomasi yo‘q yoki optovik rad etilgan/to‘xtatilgan',
  })
  create(@Body() dto: CreateProductDto, @CurrentUser() user: JwtUser) {
    return sendRpc(
      this.catalog,
      { cmd: RPC.PRODUCT_CREATE },
      { ownerUserId: user.sub, dto },
    );
  }

  @Get()
  @ApiOperation({
    summary: 'O‘z mahsulotlarim (holat va admin izohi bilan)',
  })
  @ApiOkResponse({
    description: 'Yangisi tepada; rad etilganda sababi `moderationNote` da',
    schema: { example: WHOLESALER_PRODUCTS_PAGE_EXAMPLE },
  })
  list(
    @Query() query: WholesalerProductsQueryDto,
    @CurrentUser() user: JwtUser,
  ) {
    return sendRpc(
      this.catalog,
      { cmd: RPC.PRODUCT_LIST },
      { ownerUserId: user.sub, query },
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Mahsulot kartasi' })
  @ApiOkResponse({ schema: { example: WHOLESALER_PRODUCT_EXAMPLE } })
  @ApiForbiddenResponse({ description: 'Boshqa optovikning mahsuloti' })
  @ApiNotFoundResponse({ description: 'Mahsulot topilmadi' })
  get(@Param('id', ParseLeadIdPipe) id: string, @CurrentUser() user: JwtUser) {
    return sendRpc(
      this.catalog,
      { cmd: RPC.PRODUCT_GET },
      { ownerUserId: user.sub, productId: id },
    );
  }

  @Get(':id/pricing')
  @ApiOperation({
    summary:
      'Narx hisobi (NRX-2): tavsiya narx, zararsizlik, qat’iy pastki chegara, taqsimot, platforma natijasi',
  })
  @ApiOkResponse({
    description:
      '`calculation` — narx hisobi, `evaluation` — so‘ralgan (`price`) yoki tasdiqlangan narx bo‘yicha baho; ichki siyosat va Elchi tarifi berilmaydi',
    schema: { example: WHOLESALER_PRICING_EXAMPLE },
  })
  @ApiForbiddenResponse({ description: 'Boshqa optovikning mahsuloti' })
  @ApiNotFoundResponse({ description: 'Mahsulot topilmadi' })
  pricing(
    @Param('id', ParseLeadIdPipe) id: string,
    @Query() query: WholesalerPricingQueryDto,
    @CurrentUser() user: JwtUser,
  ) {
    return sendRpc(
      this.catalog,
      { cmd: RPC.PRICING },
      { ownerUserId: user.sub, productId: id, query },
    );
  }
}
