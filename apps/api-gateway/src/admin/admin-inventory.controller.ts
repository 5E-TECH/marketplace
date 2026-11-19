import { Controller, Get, Inject, Query } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  AdminStockMovementsPageDto,
  AdminStockMovementsQueryDto,
  AdminStockPageDto,
  AdminStockQueryDto,
  AuthErrorResponseDto,
  Role,
  Roles,
  RmqClient,
  sendRpc,
} from '@app/common';

@ApiTags('admin-inventory')
@ApiBearerAuth()
// TZ 3: qoldiqni ko‘rish — omborchi va admin (BE-05)
@Roles(Role.ADMIN, Role.WAREHOUSE, Role.SUPERADMIN)
@Controller('admin/inventory')
export class AdminInventoryController {
  constructor(
    @Inject(RmqClient.INVENTORY) private readonly inventory: ClientProxy,
  ) {}

  @Get('stock')
  @ApiOperation({ summary: 'Butun platformadagi sotuvchilar qoldig‘i' })
  @ApiOkResponse({ type: AdminStockPageDto })
  @ApiUnauthorizedResponse({ type: AuthErrorResponseDto })
  @ApiForbiddenResponse({ type: AuthErrorResponseDto })
  stock(@Query() query: AdminStockQueryDto) {
    return sendRpc(
      this.inventory,
      { cmd: 'inventory.admin.stock-list' },
      { query },
    );
  }

  @Get('movements')
  @ApiOperation({ summary: 'Butun platformadagi qoldiq harakati jurnali' })
  @ApiOkResponse({ type: AdminStockMovementsPageDto })
  @ApiUnauthorizedResponse({ type: AuthErrorResponseDto })
  @ApiForbiddenResponse({ type: AuthErrorResponseDto })
  movements(@Query() query: AdminStockMovementsQueryDto) {
    return sendRpc(
      this.inventory,
      { cmd: 'inventory.admin.movements-list' },
      { query },
    );
  }
}
