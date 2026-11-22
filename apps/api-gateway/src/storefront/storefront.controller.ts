import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Inject,
  Ip,
  Logger,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { Throttle } from '@nestjs/throttler';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  CartDto,
  Public,
  RmqClient,
  sendRpc,
  SITE_ORDER_RPC,
  SiteOrderConfirmDto,
  SiteOrderConfirmedDto,
  SiteOrderCreatedDto,
  SiteOrderDto,
  StorefrontBannerDto,
  StorefrontCartDto,
  StorefrontCartItemDto,
  StorefrontProductDetailsDto,
  StorefrontProductsPageDto,
  StorefrontProductsQueryDto,
  UpdateStorefrontCartItemDto,
} from '@app/common';
import { ParseLeadIdPipe } from '../leads/lead-id.pipe';

const SESSION_HEADER = {
  name: 'x-session-id',
  required: true,
  description:
    'Mehmon savati kaliti (sayt yaratadi, 16–128 belgi: harf, raqam, - _)',
};

/**
 * BE-34: asosiy sayt katalogi — ochiq, login yo‘q. BE-18 da yopilgan storefront API yangi modelda qayta ochildi: narx —
 * tasdiqlangan narx (SAYT-2), ichki maydonlar (bazaviy narx, sotuvchi haqi, optovik ma’lumoti) qaytmaydi.
 */
@ApiTags('storefront')
@Public()
@Controller('storefront')
export class StorefrontController {
  private readonly logger = new Logger(StorefrontController.name);

  constructor(
    @Inject(RmqClient.CATALOG) private readonly catalog: ClientProxy,
    @Inject(RmqClient.CHECKOUT) private readonly checkout: ClientProxy,
    @Inject(RmqClient.LEAD) private readonly lead: ClientProxy,
  ) {}

  @Get('products')
  @ApiOperation({
    summary: 'Sayt katalogi',
    description:
      'Kategoriya, qidiruv, narx oralig‘i (`minPrice`, `maxPrice`), «faqat mavjud» (`inStock=true`), saralash va ' +
      'sahifalash. Faqat sotuvdagi va narxi tasdiqlangan mahsulotlar.',
  })
  @ApiOkResponse({ type: StorefrontProductsPageDto })
  @ApiBadRequestResponse({ description: 'Filtr noto‘g‘ri (min > max)' })
  list(
    @Query() query: StorefrontProductsQueryDto,
  ): Promise<StorefrontProductsPageDto> {
    return sendRpc(this.catalog, { cmd: 'storefront.products.list' }, query);
  }

  @Get('products/:id')
  @ApiOperation({
    summary: 'Sayt mahsuloti',
    description: '«Shu bo‘limdan» javoni (`related`) bilan.',
  })
  @ApiOkResponse({ type: StorefrontProductDetailsDto })
  @ApiNotFoundResponse({ description: 'Mahsulot topilmadi yoki sotuvda emas' })
  get(
    @Param('id', ParseLeadIdPipe) id: string,
  ): Promise<StorefrontProductDetailsDto> {
    return sendRpc(this.catalog, { cmd: 'storefront.products.get' }, { id });
  }

  @Get('banners')
  @ApiOperation({ summary: 'Sayt bannerlari (admin «Sayt kontenti»)' })
  @ApiOkResponse({ type: [StorefrontBannerDto] })
  banners(): Promise<StorefrontBannerDto[]> {
    return sendRpc(this.catalog, { cmd: 'storefront.banners.list' }, {});
  }

  // ─── Mehmon savati: `x-session-id` bo‘yicha, login yo‘q (karta; login bilan birlashtirish yo‘q) ───

  @Get('cart')
  @ApiHeader(SESSION_HEADER)
  @ApiOkResponse({ type: StorefrontCartDto })
  async cart(
    @Headers('x-session-id') sessionId?: string,
  ): Promise<StorefrontCartDto> {
    return toPublicCart(
      await sendRpc<CartDto>(
        this.checkout,
        { cmd: 'cart.get' },
        { owner: owner(sessionId) },
      ),
    );
  }

  @Post('cart/items')
  @HttpCode(200)
  @ApiHeader(SESSION_HEADER)
  @ApiOperation({
    summary: 'Savatga mahsulot qo‘shish',
    description: 'Narx — tasdiqlangan narx (savatga qo‘shilgandagi surat).',
  })
  @ApiOkResponse({ type: StorefrontCartDto })
  @ApiNotFoundResponse({ description: 'Mahsulot saytda sotuvda emas' })
  async addItem(
    @Body() item: StorefrontCartItemDto,
    @Headers('x-session-id') sessionId?: string,
  ): Promise<StorefrontCartDto> {
    return toPublicCart(
      await sendRpc<CartDto>(
        this.checkout,
        { cmd: 'cart.item.add' },
        {
          owner: owner(sessionId),
          dto: { productId: item.productId, quantity: item.quantity },
        },
      ),
    );
  }

  @Patch('cart/items/:id')
  @ApiHeader(SESSION_HEADER)
  @ApiOkResponse({ type: StorefrontCartDto })
  async updateItem(
    @Param('id', ParseLeadIdPipe) itemId: string,
    @Body() dto: UpdateStorefrontCartItemDto,
    @Headers('x-session-id') sessionId?: string,
  ): Promise<StorefrontCartDto> {
    return toPublicCart(
      await sendRpc<CartDto>(
        this.checkout,
        { cmd: 'cart.item.update' },
        { owner: owner(sessionId), itemId, quantity: dto.quantity },
      ),
    );
  }

  @Delete('cart/items/:id')
  @ApiHeader(SESSION_HEADER)
  @ApiOkResponse({ type: StorefrontCartDto })
  async removeItem(
    @Param('id', ParseLeadIdPipe) itemId: string,
    @Headers('x-session-id') sessionId?: string,
  ): Promise<StorefrontCartDto> {
    return toPublicCart(
      await sendRpc<CartDto>(
        this.checkout,
        { cmd: 'cart.item.remove' },
        { owner: owner(sessionId), itemId },
      ),
    );
  }

  @Delete('cart')
  @ApiHeader(SESSION_HEADER)
  @ApiOperation({ summary: 'Savatni bo‘shatish (idempotent)' })
  @ApiOkResponse({ type: StorefrontCartDto })
  async clearCart(
    @Headers('x-session-id') sessionId?: string,
  ): Promise<StorefrontCartDto> {
    return toPublicCart(
      await sendRpc<CartDto>(
        this.checkout,
        { cmd: 'cart.clear' },
        { owner: owner(sessionId) },
      ),
    );
  }

  // ─── Buyurtma (lid) ───────────────────────────────────────────────────────

  @Post('orders')
  // ochiq yo‘l SMS yuboradi — kirish yo‘li bilan bir xil qattiq limit (auth.controller: daqiqasiga 5) [taklif]
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiHeader(SESSION_HEADER)
  @ApiHeader({ name: 'user-agent', required: false })
  @ApiOperation({
    summary: 'Savatdan buyurtma (lid)',
    description:
      'Savatdagi hamma tovar bitta so‘rovda — lid (manba SITE). Ism, telefon, viloyat, tuman, ko‘cha/uy majburiy ' +
      '(BE-38). `confirmMode`: CALL — operator qo‘ng‘iroq qiladi; SMS — havola bosilgach buyurtma operatorsiz. ' +
      'Qora ro‘yxat yoki dublikatda server CALL qiladi (javobdagi `confirmMode`). Muvaffaqiyatda savat bo‘shatiladi.',
  })
  @ApiCreatedResponse({ type: SiteOrderCreatedDto })
  @ApiBadRequestResponse({
    description:
      'Maydon noto‘g‘ri (maydon nomi bilan) yoki savat bo‘sh (SITE_CART_EMPTY)',
  })
  @ApiConflictResponse({
    description:
      'Savatdagi mahsulot saytda sotuvda emas (SITE_PRODUCT_UNAVAILABLE)',
  })
  async order(
    @Body() order: SiteOrderDto,
    @Ip() ip: string,
    @Headers('x-session-id') sessionId?: string,
    @Headers('user-agent') userAgent?: string,
  ): Promise<SiteOrderCreatedDto> {
    const cartOwner = owner(sessionId);
    const cart = await sendRpc<CartDto>(
      this.checkout,
      { cmd: 'cart.get' },
      { owner: cartOwner },
    );
    const created = await sendRpc<SiteOrderCreatedDto>(
      this.lead,
      { cmd: SITE_ORDER_RPC.CREATE },
      {
        order,
        lines: cart.items.map((line) => ({
          productId: String(line.productId),
          quantity: line.quantity,
        })),
        ip: ip || null,
        userAgent: userAgent?.slice(0, 1000) || null,
      },
    );
    // Lid yozildi — savat bo‘shatiladi; xato bo‘lsa ham lid qoladi (takror yuborilsa dublikat qoidasi ushlaydi)
    await sendRpc(
      this.checkout,
      { cmd: 'cart.clear' },
      { owner: cartOwner },
    ).catch((error: unknown) =>
      this.logger.warn(
        `Savat bo‘shatilmadi (lid ${created.leadId}): ${(error as Error)?.message ?? error}`,
      ),
    );
    return created;
  }

  @Post('orders/confirm')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(200)
  @ApiOperation({
    summary: 'SMS havola bilan buyurtmani tasdiqlash',
    description:
      'Havola bosilgach sayt sahifasi yuboradi. Takror — o‘sha javob. Muddat o‘tgan yoki operator olgan — 409 ' +
      '(SITE_CONFIRM_EXPIRED): operator qo‘ng‘iroq qilib tasdiqlaydi.',
  })
  @ApiOkResponse({ type: SiteOrderConfirmedDto })
  @ApiNotFoundResponse({ description: 'Havola noto‘g‘ri' })
  @ApiConflictResponse({ description: 'Havola muddati o‘tgan' })
  confirm(@Body() dto: SiteOrderConfirmDto): Promise<SiteOrderConfirmedDto> {
    return sendRpc(this.lead, { cmd: SITE_ORDER_RPC.CONFIRM }, dto);
  }
}

/** Mehmon savati egasi — faqat `x-session-id` [taklif: 16–128 belgi]. */
function owner(sessionId: string | undefined): { sessionId: string } {
  const id = String(sessionId ?? '').trim();
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(id))
    throw new BadRequestException({
      message: [
        'x-session-id sarlavhasi majburiy (16–128 belgi: harf, raqam, - _)',
      ],
    });
  return { sessionId: id };
}

/** Savat javobi ochiq shaklda: optovik, variant va egasi maydonlarisiz (TC3). */
function toPublicCart(cart: CartDto): StorefrontCartDto {
  return {
    items: (cart?.items ?? []).map((item) => ({
      id: String(item.id),
      productId: String(item.productId),
      productName: item.productName,
      imageUrl: item.imageUrl ?? null,
      quantity: item.quantity,
      unitPrice: item.unitPriceSnapshot,
      lineTotal: item.lineTotal,
    })),
    totalAmount: cart?.totalAmount ?? 0,
    totalQuantity: cart?.totalQuantity ?? 0,
  };
}
