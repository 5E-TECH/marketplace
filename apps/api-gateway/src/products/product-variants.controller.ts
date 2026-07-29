import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  ParseIntPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  AuthErrorResponseDto,
  CreateProductVariantDto,
  CurrentUser,
  JwtUser,
  ProductVariantDto,
  Role,
  Roles,
  RmqClient,
  sendRpc,
  UpdateProductVariantDto,
} from '@app/common';

@ApiTags('product variants')
@ApiBearerAuth()
@Roles(Role.SELLER)
@Controller('products/:productId/variants')
export class ProductVariantsController {
  constructor(
    @Inject(RmqClient.CATALOG) private readonly catalog: ClientProxy,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Mahsulotga variant qo‘shish' })
  @ApiCreatedResponse({ type: ProductVariantDto })
  @ApiBadRequestResponse({ type: AuthErrorResponseDto })
  @ApiUnauthorizedResponse({ type: AuthErrorResponseDto })
  @ApiForbiddenResponse({ type: AuthErrorResponseDto })
  @ApiConflictResponse({ type: AuthErrorResponseDto })
  @ApiNotFoundResponse({ type: AuthErrorResponseDto })
  create(
    @CurrentUser() user: JwtUser,
    @Param('productId', ParseIntPipe) productId: number,
    @Body() dto: CreateProductVariantDto,
  ) {
    return sendRpc(
      this.catalog,
      { cmd: 'product-variant.create' },
      {
        ownerUserId: user.sub,
        productId: String(productId),
        dto,
      },
    );
  }

  @Get()
  @ApiOperation({ summary: 'Mahsulot variantlarini olish' })
  @ApiOkResponse({ type: [ProductVariantDto] })
  list(
    @CurrentUser() user: JwtUser,
    @Param('productId', ParseIntPipe) productId: number,
  ) {
    return sendRpc(
      this.catalog,
      { cmd: 'product-variant.list' },
      {
        ownerUserId: user.sub,
        productId: String(productId),
      },
    );
  }

  @Get(':variantId')
  @ApiOperation({ summary: 'Bitta mahsulot variantini olish' })
  @ApiOkResponse({ type: ProductVariantDto })
  @ApiForbiddenResponse({ type: AuthErrorResponseDto })
  @ApiNotFoundResponse({ type: AuthErrorResponseDto })
  getOne(
    @CurrentUser() user: JwtUser,
    @Param('productId', ParseIntPipe) productId: number,
    @Param('variantId', ParseIntPipe) variantId: number,
  ) {
    return sendRpc(
      this.catalog,
      { cmd: 'product-variant.get-one' },
      {
        ownerUserId: user.sub,
        productId: String(productId),
        variantId: String(variantId),
      },
    );
  }

  @Patch(':variantId')
  @ApiOperation({ summary: 'Mahsulot variantini tahrirlash' })
  @ApiOkResponse({ type: ProductVariantDto })
  @ApiBadRequestResponse({ type: AuthErrorResponseDto })
  @ApiForbiddenResponse({ type: AuthErrorResponseDto })
  @ApiConflictResponse({ type: AuthErrorResponseDto })
  @ApiNotFoundResponse({ type: AuthErrorResponseDto })
  update(
    @CurrentUser() user: JwtUser,
    @Param('productId', ParseIntPipe) productId: number,
    @Param('variantId', ParseIntPipe) variantId: number,
    @Body() dto: UpdateProductVariantDto,
  ) {
    return sendRpc(
      this.catalog,
      { cmd: 'product-variant.update' },
      {
        ownerUserId: user.sub,
        productId: String(productId),
        variantId: String(variantId),
        dto,
      },
    );
  }

  @Delete(':variantId')
  @ApiOperation({ summary: 'Mahsulot variantini soft-delete qilish' })
  @ApiOkResponse({ schema: { example: { id: '25', deleted: true } } })
  @ApiForbiddenResponse({ type: AuthErrorResponseDto })
  @ApiConflictResponse({ type: AuthErrorResponseDto })
  @ApiNotFoundResponse({ type: AuthErrorResponseDto })
  remove(
    @CurrentUser() user: JwtUser,
    @Param('productId', ParseIntPipe) productId: number,
    @Param('variantId', ParseIntPipe) variantId: number,
  ) {
    return sendRpc(
      this.catalog,
      { cmd: 'product-variant.delete' },
      {
        ownerUserId: user.sub,
        productId: String(productId),
        variantId: String(variantId),
      },
    );
  }
}
