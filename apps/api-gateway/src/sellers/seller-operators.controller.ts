import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CreateOperatorDto,
  CurrentUser,
  JwtUser,
  RmqClient,
  Role,
  Roles,
  sendRpc,
  UpdateOperatorDto,
} from '@app/common';

/**
 * Market operatorlari (C1.38) — sotuvchi o'z do'koniga xodim (operator) qo'shadi/
 * o'chiradi. shopId ownerUserId'dan (catalog) resolve qilinadi; identity operator
 * userni role=OPERATOR + shopId bilan yaratadi. Faqat SELLER (owner).
 */
@ApiTags('seller')
@ApiBearerAuth()
@Roles(Role.SELLER)
@Controller('sellers/operators')
export class SellerOperatorsController {
  constructor(
    @Inject(RmqClient.IDENTITY) private readonly identity: ClientProxy,
    @Inject(RmqClient.CATALOG) private readonly catalog: ClientProxy,
  ) {}

  private async shopId(user: JwtUser): Promise<string> {
    const shop = await sendRpc<{ id: string }>(
      this.catalog,
      { cmd: 'seller.shop.get-me' },
      { ownerUserId: user.sub },
    );
    return shop.id;
  }

  @Post()
  @ApiOperation({ summary: 'Do‘konga operator qo‘shish' })
  async create(@CurrentUser() user: JwtUser, @Body() dto: CreateOperatorDto) {
    const shopId = await this.shopId(user);
    return sendRpc(
      this.identity,
      { cmd: 'identity.operator.create' },
      { shopId, dto },
    );
  }

  @Get()
  @ApiOperation({ summary: 'Do‘kon operatorlari ro‘yxati' })
  async list(@CurrentUser() user: JwtUser) {
    const shopId = await this.shopId(user);
    return sendRpc(
      this.identity,
      { cmd: 'identity.operator.list' },
      { shopId },
    );
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Do‘kon operatorini yangilash' })
  async update(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Body() dto: UpdateOperatorDto,
  ) {
    const shopId = await this.shopId(user);
    return sendRpc(
      this.identity,
      { cmd: 'identity.operator.update' },
      { shopId, operatorId: id, dto },
    );
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Operatorni o‘chirish' })
  async remove(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    const shopId = await this.shopId(user);
    return sendRpc(
      this.identity,
      { cmd: 'identity.operator.remove' },
      { shopId, operatorId: id },
    );
  }
}
