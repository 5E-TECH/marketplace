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
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  AuthErrorResponseDto,
  CreateWarehouseDto,
  CurrentUser,
  JwtUser,
  RmqClient,
  Role,
  Roles,
  sendRpc,
  StockPageDto,
  StockAdjustDto,
  StockInboundDto,
  StockMutationResultDto,
  StockQueryDto,
  UpdateWarehouseDto,
  WarehouseDto,
} from '@app/common';

@ApiTags('inventory')
@ApiBearerAuth()
@Roles(Role.SELLER)
@Controller('inventory')
export class InventoryController {
  constructor(
    @Inject(RmqClient.INVENTORY)
    private readonly inventory: ClientProxy,
  ) {}

  @Get('warehouses')
  @ApiOperation({ summary: 'Sotuvchining faol omborlarini olish' })
  @ApiOkResponse({ type: [WarehouseDto] })
  listWarehouses(@CurrentUser() user: JwtUser) {
    return this.call('inventory.warehouse.list', user);
  }

  @Post('warehouses')
  @ApiOperation({ summary: 'Yangi ombor yaratish' })
  @ApiCreatedResponse({ type: WarehouseDto })
  createWarehouse(
    @CurrentUser() user: JwtUser,
    @Body() dto: CreateWarehouseDto,
  ) {
    return this.call('inventory.warehouse.create', user, { dto });
  }

  @Get('warehouses/:id')
  @ApiOperation({ summary: 'Bitta omborni olish' })
  @ApiOkResponse({ type: WarehouseDto })
  @ApiNotFoundResponse({ type: AuthErrorResponseDto })
  getWarehouse(
    @CurrentUser() user: JwtUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.call('inventory.warehouse.get-one', user, {
      warehouseId: String(id),
    });
  }

  @Patch('warehouses/:id')
  @ApiOperation({ summary: 'Omborni tahrirlash' })
  @ApiOkResponse({ type: WarehouseDto })
  @ApiNotFoundResponse({ type: AuthErrorResponseDto })
  updateWarehouse(
    @CurrentUser() user: JwtUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateWarehouseDto,
  ) {
    return this.call('inventory.warehouse.update', user, {
      warehouseId: String(id),
      dto,
    });
  }

  @Delete('warehouses/:id')
  @ApiOperation({ summary: 'Omborni soft-delete qilish' })
  @ApiOkResponse({ schema: { example: { id: '3', deleted: true } } })
  @ApiNotFoundResponse({ type: AuthErrorResponseDto })
  deleteWarehouse(
    @CurrentUser() user: JwtUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.call('inventory.warehouse.delete', user, {
      warehouseId: String(id),
    });
  }

  @Get('stock/low')
  @ApiOperation({ summary: 'Kam qolgan tovarlarni olish' })
  @ApiOkResponse({ type: StockPageDto })
  lowStock(@CurrentUser() user: JwtUser, @Query() query: StockQueryDto) {
    return this.call('inventory.stock.low', user, { query });
  }

  @Get('stock')
  @ApiOperation({ summary: 'Sotuvchining qoldig‘ini olish' })
  @ApiOkResponse({ type: StockPageDto })
  listStock(@CurrentUser() user: JwtUser, @Query() query: StockQueryDto) {
    return this.call('inventory.stock.list', user, { query });
  }

  @Post('stock/inbound')
  @ApiOperation({ summary: 'Tovarni omborga kirim qilish' })
  @ApiOkResponse({ type: StockMutationResultDto })
  inbound(@CurrentUser() user: JwtUser, @Body() dto: StockInboundDto) {
    return this.call('inventory.stock.inbound', user, { dto });
  }

  @Post('stock/adjust')
  @ApiOperation({ summary: 'Ombor qoldig‘ini sabab bilan tuzatish' })
  @ApiOkResponse({ type: StockMutationResultDto })
  adjust(@CurrentUser() user: JwtUser, @Body() dto: StockAdjustDto) {
    return this.call('inventory.stock.adjust', user, { dto });
  }

  private call(cmd: string, user: JwtUser, data: Record<string, unknown> = {}) {
    return sendRpc(this.inventory, { cmd }, { ownerUserId: user.sub, ...data });
  }
}
