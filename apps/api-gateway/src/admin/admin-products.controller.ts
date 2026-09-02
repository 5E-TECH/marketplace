import {
  Controller,
  Get,
  Inject,
  Ip,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  AdminProductsQueryDto,
  CurrentUser,
  JwtUser,
  ProductDto,
  Role,
  Roles,
  RmqClient,
  sendRpc,
} from '@app/common';

@ApiTags('admin-products')
@ApiBearerAuth()
@Roles(Role.ADMIN, Role.SUPERADMIN)
@Controller('admin/products')
export class AdminProductsController {
  constructor(
    @Inject(RmqClient.CATALOG) private readonly catalog: ClientProxy,
    @Inject(RmqClient.IDENTITY) private readonly identity: ClientProxy,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Admin uchun barcha mahsulotlar va moderatsiya filtrlari',
  })
  list(@Query() query: AdminProductsQueryDto) {
    return sendRpc(
      this.catalog,
      { cmd: 'catalog.product.admin-list' },
      { query },
    );
  }

  @Get(':id')
  @ApiOkResponse({ type: ProductDto })
  get(@Param('id') id: string) {
    return sendRpc(
      this.catalog,
      { cmd: 'catalog.product.admin-get' },
      { productId: id },
    );
  }

  @Post(':id/suspend')
  async suspend(
    @Param('id') id: string,
    @CurrentUser() admin: JwtUser,
    @Ip() ip: string,
  ) {
    const product = await sendRpc(
      this.catalog,
      { cmd: 'catalog.product.admin-suspend' },
      { productId: id },
    );
    this.audit(admin.sub, 'product.suspend', id, ip);
    return product;
  }

  @Post(':id/reactivate')
  async reactivate(
    @Param('id') id: string,
    @CurrentUser() admin: JwtUser,
    @Ip() ip: string,
  ) {
    const product = await sendRpc(
      this.catalog,
      { cmd: 'catalog.product.admin-reactivate' },
      { productId: id },
    );
    this.audit(admin.sub, 'product.reactivate', id, ip);
    return product;
  }

  private audit(
    actorId: string,
    action: string,
    entityId: string,
    ip?: string,
  ): void {
    void sendRpc(
      this.identity,
      { cmd: 'identity.audit.log' },
      {
        actorId,
        action,
        entityType: 'Product',
        entityId,
        meta: { ip: ip ?? null },
      },
    ).catch(() => undefined);
  }
}
