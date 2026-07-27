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
  Query,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
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
  CreateProductDto,
  CurrentUser,
  JwtUser,
  MyProductsPageDto,
  MyProductsQueryDto,
  ProductDto,
  Role,
  Roles,
  RmqClient,
  sendRpc,
  UpdateProductDto,
} from '@app/common';

@ApiTags('products')
@ApiBearerAuth()
@Roles(Role.SELLER)
@Controller('products')
export class ProductsController {
  constructor(
    @Inject(RmqClient.CATALOG) private readonly catalog: ClientProxy,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Sotuvchining yangi mahsulotini yaratish' })
  @ApiCreatedResponse({ type: ProductDto })
  @ApiBadRequestResponse({ type: AuthErrorResponseDto })
  @ApiUnauthorizedResponse({ type: AuthErrorResponseDto })
  @ApiForbiddenResponse({ type: AuthErrorResponseDto })
  @ApiNotFoundResponse({ type: AuthErrorResponseDto })
  create(@CurrentUser() user: JwtUser, @Body() dto: CreateProductDto) {
    return sendRpc(
      this.catalog,
      { cmd: 'product.create' },
      {
        ownerUserId: user.sub,
        dto,
      },
    );
  }

  @Get('my')
  @ApiOperation({ summary: 'Joriy sotuvchining mahsulotlarini olish' })
  @ApiOkResponse({ type: MyProductsPageDto })
  getMine(@CurrentUser() user: JwtUser, @Query() query: MyProductsQueryDto) {
    return sendRpc(
      this.catalog,
      { cmd: 'product.get-mine' },
      {
        ownerUserId: user.sub,
        query,
      },
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Joriy sotuvchining bitta mahsulotini olish' })
  @ApiOkResponse({ type: ProductDto })
  @ApiForbiddenResponse({ type: AuthErrorResponseDto })
  @ApiNotFoundResponse({ type: AuthErrorResponseDto })
  getOne(@CurrentUser() user: JwtUser, @Param('id', ParseIntPipe) id: number) {
    return sendRpc(
      this.catalog,
      { cmd: 'product.get-one' },
      {
        ownerUserId: user.sub,
        id: String(id),
      },
    );
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Joriy sotuvchining mahsulotini tahrirlash' })
  @ApiOkResponse({ type: ProductDto })
  @ApiBadRequestResponse({ type: AuthErrorResponseDto })
  @ApiForbiddenResponse({ type: AuthErrorResponseDto })
  @ApiNotFoundResponse({ type: AuthErrorResponseDto })
  update(
    @CurrentUser() user: JwtUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateProductDto,
  ) {
    return sendRpc(
      this.catalog,
      { cmd: 'product.update' },
      {
        ownerUserId: user.sub,
        id: String(id),
        dto,
      },
    );
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Joriy sotuvchining mahsulotini soft-delete qilish',
  })
  @ApiOkResponse({ schema: { example: { id: '12', deleted: true } } })
  @ApiForbiddenResponse({ type: AuthErrorResponseDto })
  @ApiNotFoundResponse({ type: AuthErrorResponseDto })
  remove(@CurrentUser() user: JwtUser, @Param('id', ParseIntPipe) id: number) {
    return sendRpc(
      this.catalog,
      { cmd: 'product.delete' },
      {
        ownerUserId: user.sub,
        id: String(id),
      },
    );
  }
}
