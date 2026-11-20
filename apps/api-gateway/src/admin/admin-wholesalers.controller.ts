import {
  Body,
  Controller,
  Get,
  Inject,
  Ip,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  AdminWholesalersQueryDto,
  CreateWholesalerDto,
  CurrentUser,
  JwtUser,
  RmqClient,
  Role,
  Roles,
  sendRpc,
  UpdateWholesalerDto,
  WholesalerDto,
  WholesalerPageDto,
} from '@app/common';

/**
 * BE-07 (OPT-1, FE-25): optovikni admin kiritadi — foydalanuvchisiz, rekvizitlar va komissiya shartnomasi bilan.
 * Har amal audit jurnaliga yoziladi (ADM-6).
 */
@ApiTags('admin-wholesalers')
@ApiBearerAuth()
@Roles(Role.ADMIN, Role.SUPERADMIN)
@Controller('admin/wholesalers')
export class AdminWholesalersController {
  constructor(
    @Inject(RmqClient.CATALOG) private readonly catalog: ClientProxy,
    @Inject(RmqClient.IDENTITY) private readonly identity: ClientProxy,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Optovikni kiritish (foydalanuvchisiz)' })
  @ApiCreatedResponse({ type: WholesalerDto })
  async create(
    @Body() dto: CreateWholesalerDto,
    @CurrentUser() admin: JwtUser,
    @Ip() ip: string,
  ) {
    const wholesaler = await sendRpc<WholesalerDto>(
      this.catalog,
      { cmd: 'catalog.wholesaler.admin-create' },
      dto,
    );
    this.audit(admin.sub, 'wholesaler.create', wholesaler.id, ip, {
      after: wholesaler,
    });
    return wholesaler;
  }

  @Get()
  @ApiOperation({
    summary: 'Optoviklar ro‘yxati (nom yoki STIR bo‘yicha qidiruv)',
  })
  @ApiOkResponse({ type: WholesalerPageDto })
  list(@Query() query: AdminWholesalersQueryDto) {
    return sendRpc(
      this.catalog,
      { cmd: 'catalog.wholesaler.admin-list' },
      query,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Optovik' })
  @ApiOkResponse({ type: WholesalerDto })
  get(@Param('id') id: string) {
    return sendRpc(
      this.catalog,
      { cmd: 'catalog.wholesaler.admin-get' },
      { id },
    );
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Optovik rekvizitlari va shartnomasini tahrirlash' })
  @ApiOkResponse({ type: WholesalerDto })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateWholesalerDto,
    @CurrentUser() admin: JwtUser,
    @Ip() ip: string,
  ) {
    const wholesaler = await sendRpc<WholesalerDto>(
      this.catalog,
      { cmd: 'catalog.wholesaler.admin-update' },
      { id, dto },
    );
    this.audit(admin.sub, 'wholesaler.update', id, ip, { changes: dto });
    return wholesaler;
  }

  private audit(
    actorId: string,
    action: string,
    entityId: string,
    ip: string | undefined,
    meta: Record<string, unknown>,
  ): void {
    void sendRpc(
      this.identity,
      { cmd: 'identity.audit.log' },
      {
        actorId,
        action,
        entityType: 'Wholesaler',
        entityId,
        meta: { ...meta, ip: ip ?? null },
      },
    ).catch(() => undefined);
  }
}
