import { Controller, Get, Inject } from '@nestjs/common';
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
  AdminDashboardDto,
  AuthErrorResponseDto,
  Role,
  Roles,
  RmqClient,
  sendRpc,
} from '@app/common';

interface ShopCounts {
  total: number;
  PENDING: number;
  ACTIVE: number;
  SUSPENDED: number;
  REJECTED: number;
}
interface UserCounts {
  total: number;
  SELLER: number;
  BUYER: number;
  ADMIN: number;
  OPERATOR: number;
  SUPERADMIN: number;
}
interface OrderStats {
  ordersTotal: number;
  ordersToday: number;
  gmv: number;
  revenue: number;
}

/**
 * C1.28 — Admin platforma dashboard'i. Global JwtAuthGuard + RolesGuard bor, shu
 * bois faqat `@Roles(ADMIN, SUPERADMIN)` yetarli. Uch servisni (catalog/identity/
 * checkout) `Promise.all` bilan parallel so'raydi va yagona javobga jamlaydi.
 * Yangi platformada barcha son 0 (xato emas).
 */
@ApiTags('admin-dashboard')
@Controller()
export class AdminDashboardController {
  constructor(
    @Inject(RmqClient.CATALOG) private readonly catalog: ClientProxy,
    @Inject(RmqClient.IDENTITY) private readonly identity: ClientProxy,
    @Inject(RmqClient.CHECKOUT) private readonly checkout: ClientProxy,
  ) {}

  @Get('admin/dashboard')
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Platforma statistikasi (do‘kon/user/buyurtma + GMV/daromad)',
  })
  @ApiOkResponse({ type: AdminDashboardDto })
  @ApiUnauthorizedResponse({ type: AuthErrorResponseDto })
  @ApiForbiddenResponse({ type: AuthErrorResponseDto })
  async dashboard(): Promise<AdminDashboardDto> {
    const [shops, users, orders] = await Promise.all([
      sendRpc<ShopCounts>(
        this.catalog,
        { cmd: 'catalog.shop.count-by-status' },
        {},
      ),
      sendRpc<UserCounts>(
        this.identity,
        { cmd: 'identity.user.count-by-role' },
        {},
      ),
      sendRpc<OrderStats>(this.checkout, { cmd: 'checkout.admin.stats' }, {}),
    ]);

    return {
      shops: {
        total: shops.total,
        pending: shops.PENDING,
        active: shops.ACTIVE,
        suspended: shops.SUSPENDED,
        rejected: shops.REJECTED,
      },
      users: {
        total: users.total,
        sellers: users.SELLER,
        buyers: users.BUYER,
        admins: users.ADMIN,
        operators: users.OPERATOR,
      },
      orders: { total: orders.ordersTotal, today: orders.ordersToday },
      gmv: orders.gmv,
      revenue: orders.revenue,
    };
  }
}
