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
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  AdminUsersQueryDto,
  AuthErrorResponseDto,
  CurrentUser,
  JwtUser,
  Role,
  Roles,
  RmqClient,
  sendRpc,
} from '@app/common';

/**
 * C1.29 — Admin foydalanuvchilar boshqaruvi. Global JwtAuthGuard + RolesGuard,
 * shu bois faqat `@Roles(ADMIN, SUPERADMIN)`. block/unblock'da amalni bajaruvchi
 * admin id'si (`actorId`) uzatiladi — identity o'zini-bloklashni rad etadi (409).
 */
@ApiTags('admin-users')
@Controller()
export class AdminUsersController {
  constructor(
    @Inject(RmqClient.IDENTITY) private readonly identity: ClientProxy,
  ) {}

  @Get('admin/users')
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Foydalanuvchilar (rol/blok/qidiruv + sahifalash)' })
  @ApiOkResponse({ description: '{ items, total, page, limit, totalPages }' })
  @ApiUnauthorizedResponse({ type: AuthErrorResponseDto })
  @ApiForbiddenResponse({ type: AuthErrorResponseDto })
  list(@Query() query: AdminUsersQueryDto) {
    return sendRpc(
      this.identity,
      { cmd: 'identity.user.admin-list' },
      { query },
    );
  }

  @Get('admin/users/:id')
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Foydalanuvchi profili' })
  @ApiForbiddenResponse({ type: AuthErrorResponseDto })
  get(@Param('id') id: string) {
    return sendRpc(
      this.identity,
      { cmd: 'identity.user.admin-get' },
      { userId: id },
    );
  }

  @Post('admin/users/:id/block')
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Foydalanuvchini bloklash (o‘zini → 409)' })
  @ApiForbiddenResponse({ type: AuthErrorResponseDto })
  async block(
    @CurrentUser() admin: JwtUser,
    @Param('id') id: string,
    @Ip() ip: string,
  ) {
    const res = await sendRpc(
      this.identity,
      { cmd: 'identity.user.set-blocked' },
      { actorId: admin.sub, userId: id, blocked: true },
    );
    // C1.31 — audit (best-effort): amal muvaffaqiyatidan so'ng yoziladi.
    this.audit(admin.sub, 'user.block', 'User', id, ip);
    return res;
  }

  @Post('admin/users/:id/unblock')
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Foydalanuvchini blokdan chiqarish' })
  @ApiForbiddenResponse({ type: AuthErrorResponseDto })
  async unblock(
    @CurrentUser() admin: JwtUser,
    @Param('id') id: string,
    @Ip() ip: string,
  ) {
    const res = await sendRpc(
      this.identity,
      { cmd: 'identity.user.set-blocked' },
      { actorId: admin.sub, userId: id, blocked: false },
    );
    this.audit(admin.sub, 'user.unblock', 'User', id, ip);
    return res;
  }

  /** C1.31 — audit sink'ga best-effort yozadi (xatoda amalни buzmaydi). */
  private audit(
    actorId: string,
    action: string,
    entityType: string,
    entityId: string,
    ip?: string,
  ): void {
    void sendRpc(
      this.identity,
      { cmd: 'identity.audit.log' },
      { actorId, action, entityType, entityId, meta: { ip: ip ?? null } },
    ).catch(() => undefined);
  }
}
