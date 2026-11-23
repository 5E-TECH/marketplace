import {
  Controller,
  Body,
  Get,
  HttpCode,
  HttpStatus,
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
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  AdminUserDto,
  AdminUsersQueryDto,
  AffiliateStreamStatus,
  AuthErrorResponseDto,
  CurrentUser,
  ImpersonationResultDto,
  JwtUser,
  Role,
  Roles,
  RmqClient,
  sendRpc,
  UpdateUserRoleDto,
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
    @Inject(RmqClient.LEAD) private readonly lead: ClientProxy,
  ) {}

  @Get('admin/users')
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Foydalanuvchilar (rol/blok/qidiruv + sahifalash)' })
  @ApiOkResponse({
    description:
      '{ items, total, page, limit, totalPages }; items — foydalanuvchi kartasi (AdminUserDto shakli)',
    schema: {
      example: {
        items: [
          {
            id: '42',
            role: 'OPERATOR_LEAD',
            name: 'Dilnoza',
            firstName: null,
            lastName: null,
            phone: '+998901112233',
            email: null,
            avatarUrl: null,
            isActive: true,
            isBlocked: false,
            authVersion: 1,
            totpEnabledAt: null,
            isDeleted: false,
            createdAt: '2026-11-20T08:00:00.000Z',
            updatedAt: '2026-11-20T08:00:00.000Z',
          },
        ],
        total: 1,
        page: 1,
        limit: 20,
        totalPages: 1,
      },
    },
  })
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
  @ApiOkResponse({ type: AdminUserDto })
  @ApiConflictResponse({ description: 'Foydalanuvchi topilmadi' })
  @ApiForbiddenResponse({ type: AuthErrorResponseDto })
  get(@Param('id') id: string) {
    return sendRpc(
      this.identity,
      { cmd: 'identity.user.admin-get' },
      { userId: id },
    );
  }

  @Patch('admin/users/:id/role')
  @Roles(Role.SUPERADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Foydalanuvchi rolini o‘zgartirish' })
  @ApiOkResponse({
    description: 'Yangilangan foydalanuvchi (qisqa ko‘rinish)',
    schema: {
      example: {
        id: '42',
        name: 'Dilnoza',
        phone: '+998901112233',
        email: null,
        role: 'OPERATOR_LEAD',
        isActive: true,
        isBlocked: false,
        createdAt: '2026-11-20T08:00:00.000Z',
        updatedAt: '2026-11-23T09:00:00.000Z',
      },
    },
  })
  @ApiForbiddenResponse({ type: AuthErrorResponseDto })
  updateRole(
    @CurrentUser() admin: JwtUser,
    @Param('id') id: string,
    @Body() dto: UpdateUserRoleDto,
    @Ip() ip: string,
  ) {
    return sendRpc(
      this.identity,
      { cmd: 'identity.user.role.update' },
      { actorId: admin.sub, userId: id, dto, ip },
    );
  }

  @Post('admin/users/:id/impersonate')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.SUPERADMIN)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Foydalanuvchi nomidan 15 daqiqalik vaqtinchalik kirish',
  })
  @ApiOkResponse({ type: ImpersonationResultDto })
  @ApiForbiddenResponse({ type: AuthErrorResponseDto })
  impersonate(
    @CurrentUser() admin: JwtUser,
    @Param('id') id: string,
    @Ip() ip: string,
  ) {
    return sendRpc(
      this.identity,
      { cmd: 'identity.user.impersonate' },
      { actorId: admin.sub, userId: id, ip },
    );
  }

  @Post('admin/users/:id/block')
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Foydalanuvchini bloklash (o‘zini → 409)' })
  @ApiCreatedResponse({
    type: AdminUserDto,
    description:
      'Bloklangan foydalanuvchi; sotuvchi bo‘lsa sahifalari to‘xtaydi',
  })
  @ApiConflictResponse({
    description: 'O‘zini bloklash yoki foydalanuvchi topilmadi',
  })
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
    // audit sahifalardan oldin: lead-service xato bersa ham blok auditda qoladi
    this.audit(admin.sub, 'user.block', 'User', id, ip);
    // BE-27 (BE-11 TC11): bloklangan sotuvchining hamma sahifasi to‘xtaydi — lid qabul qilinmaydi
    await this.affiliateStreams(res, AffiliateStreamStatus.STOPPED);
    return res;
  }

  @Post('admin/users/:id/unblock')
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Foydalanuvchini blokdan chiqarish' })
  @ApiCreatedResponse({ type: AdminUserDto })
  @ApiConflictResponse({ description: 'Foydalanuvchi topilmadi' })
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
    // audit sahifalardan oldin: lead-service xato bersa ham blok auditda qoladi
    this.audit(admin.sub, 'user.unblock', 'User', id, ip);
    // BE-27: blokdan chiqsa sahifalari qayta ochiladi (firibgarlik sababli to‘xtatilgani — yo‘q, BE-35)
    await this.affiliateStreams(res, AffiliateStreamStatus.ACTIVE);
    return res;
  }

  /**
   * Sotuvchi (AFFILIATE) bo‘lsa — sahifalar holati lead-service da. Xato yashirilmaydi: blok saqlangan, sahifalar
   * esa ochiq qolsa admin xatoni ko‘rib qayta bosadi (bloklash takrorlansa ham zarari yo‘q).
   */
  private async affiliateStreams(
    user: unknown,
    status: AffiliateStreamStatus,
  ): Promise<void> {
    const u = (user ?? {}) as { id?: string | number; role?: string };
    if (u.role !== Role.AFFILIATE || !u.id) return;
    await sendRpc(
      this.lead,
      { cmd: 'lead.affiliate.streams.set-status' },
      { affiliateId: String(u.id), status },
    );
  }

  /** BE-26: xodimning 2FA sini nolga tushirish (telefon va tiklash kodlari yo‘qolgan) — sessiyalari yopiladi. */
  @Post('admin/users/:id/2fa/reset')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.SUPERADMIN)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Xodim 2FA sini nolga tushirish (keyingi kirishda qayta ulaydi)',
  })
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: { reset: { type: 'boolean', example: true } },
      example: { reset: true },
    },
  })
  @ApiForbiddenResponse({ type: AuthErrorResponseDto })
  async resetTwoFactor(
    @CurrentUser() admin: JwtUser,
    @Param('id') id: string,
    @Ip() ip: string,
  ) {
    const res = await sendRpc(
      this.identity,
      { cmd: 'identity.2fa.reset' },
      { actorId: admin.sub, userId: id },
    );
    this.audit(admin.sub, 'user.2fa.reset', 'User', id, ip);
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
