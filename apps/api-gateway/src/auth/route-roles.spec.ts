import { readdirSync, statSync } from 'fs';
import { join } from 'path';
import { ExecutionContext, HttpException, RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { of, throwError } from 'rxjs';
import {
  IS_PUBLIC_KEY,
  JwtAuthGuard,
  LegacyRole,
  Role,
  ROLES_KEY,
  RolesGuard,
} from '@app/common';
import { CurrentRoleGuard } from './current-role.guard';

/**
 * BE-05: gateway'ning har bir yo‘li global guard zanjiridan (JwtAuthGuard → CurrentRoleGuard → RolesGuard, app.module
 * dagi tartibda) tokensiz, sakkiz rolning har biri va bloklangan foydalanuvchi bilan o‘tkaziladi. Kutilgan ruxsatlar —
 * TZ 3-bo‘lim jadvali; yangi yo‘l qo‘shilsa yoki rol o‘zgarsa, shu ro‘yxat ham o‘zgarishi kerak.
 */

interface RouteInfo {
  key: string; // 'GET /admin/leads'
  cls: object;
  handler: object;
  isPublic: boolean;
  roles: Array<Role | LegacyRole> | undefined;
}

const controllerFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return controllerFiles(path);
    return path.endsWith('.controller.ts') ? [path] : [];
  });

const join_ = (...parts: string[]) =>
  '/' +
  parts
    .flatMap((part) => part.split('/'))
    .filter(Boolean)
    .join('/');

function collectRoutes(): RouteInfo[] {
  const reflector = new Reflector();
  const routes: RouteInfo[] = [];
  for (const file of controllerFiles(join(__dirname, '..'))) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const exported = require(file) as Record<string, unknown>;
    for (const cls of Object.values(exported)) {
      if (typeof cls !== 'function') continue;
      const base: unknown = Reflect.getMetadata(PATH_METADATA, cls);
      if (base === undefined) continue;
      for (const name of Object.getOwnPropertyNames(cls.prototype)) {
        const handler = cls.prototype[name];
        if (name === 'constructor' || typeof handler !== 'function') continue;
        const method: RequestMethod | undefined = Reflect.getMetadata(
          METHOD_METADATA,
          handler,
        );
        if (method === undefined) continue;
        const paths: string[] = [].concat(
          Reflect.getMetadata(PATH_METADATA, handler) ?? '',
        );
        const bases: string[] = [].concat(base as never);
        const isPublic = !!reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
          handler,
          cls,
        ]);
        const roles = reflector.getAllAndOverride<
          Array<Role | LegacyRole> | undefined
        >(ROLES_KEY, [handler, cls]);
        for (const b of bases)
          for (const p of paths)
            routes.push({
              key: `${RequestMethod[method]} ${join_(b, p)}`,
              cls,
              handler,
              isPublic,
              roles,
            });
      }
    }
  }
  return routes.sort((a, b) => a.key.localeCompare(b.key));
}

const routes = collectRoutes();
const routeKeys = routes.map((route) => route.key);

/** Tizimga kirgan har kimga ochiq: o‘z profili, sessiyalari, bildirishnomalari va murojaatlari. */
const ANY_SIGNED_IN = [
  'DELETE /auth/sessions/:id',
  'GET /auth/me',
  'GET /auth/sessions',
  'GET /notifications',
  'GET /support/tickets',
  'GET /support/tickets/:id',
  'GET /whoami',
  'PATCH /auth/profile',
  'PATCH /notifications/:id/read',
  'PATCH /notifications/read-all',
  'POST /auth/logout',
  'POST /support/tickets',
  'POST /support/tickets/:id/messages',
];

/** TZ 3-bo‘lim jadvali bo‘yicha har rolga ochiq yo‘llar (ANY_SIGNED_IN dan tashqari). */
const EXPECTED: Partial<Record<Role, string[]>> = {
  // Offerlar, oqim va postback, o‘z lidlari statistikasi, pul yechish — faqat sotuvchi.
  [Role.AFFILIATE]: routeKeys.filter((key) =>
    /^[A-Z]+ \/affiliate\//.test(key),
  ),
  // Optovik kabineti BE-30 da; hozircha faqat umumiy yo‘llar.
  [Role.WHOLESALER]: [],
  // Lidni bron qilish va natija kiritish.
  [Role.OPERATOR_LEAD]: [
    'GET /operator/leads',
    'GET /operator/leads/:id',
    'GET /operator/stats',
    'PATCH /operator/leads/:id/address',
    'POST /operator/leads/:id/quote',
    'POST /operator/leads/:id/result',
    'POST /operator/leads/next',
    'PUT /operator/state',
  ],
  // Operator ishi + navbat xulosasi, o‘tkazish va qizil ro‘yxat, lidlar ro‘yxati (qayta ochish — faqat admin).
  [Role.SUPERVISOR]: [
    'GET /admin/leads',
    'GET /admin/leads/:id',
    'GET /operator/leads',
    'GET /operator/leads/:id',
    'GET /operator/queue-summary',
    'GET /operator/stats',
    'GET /supervisor/red-list',
    'GET /supervisor/transfers',
    'PATCH /operator/leads/:id/address',
    'POST /operator/leads/:id/quote',
    'POST /operator/leads/:id/result',
    'POST /operator/leads/next',
    'POST /supervisor/leads/:id/transfer',
    'PUT /operator/state',
  ],
  // Qoldiqni ko‘rish (qabul va yig‘ish yo‘llari BE-16, BE-19 da).
  [Role.WAREHOUSE]: [
    'GET /admin/inventory/movements',
    'GET /admin/inventory/stock',
  ],
  // To‘lovni tasdiqlash va Elchi sverkasi.
  [Role.FINANCE]: [
    'GET /admin/finance/ledger',
    'GET /admin/finance/reports',
    'GET /admin/finance/reports/reconciliation',
    'GET /admin/finance/settlements',
    'GET /admin/finance/settlements/:id',
    'GET /admin/finance/settlements/:id/act.pdf',
    'GET /admin/finance/settlements/bank-file',
    'GET /admin/finance/withdrawals',
    'POST /admin/finance/settlements/:id/paid',
    'POST /admin/finance/settlements/run',
    'POST /admin/finance/withdrawals/:id/approve',
    'POST /admin/finance/withdrawals/:id/paid',
    'POST /admin/finance/withdrawals/:id/reject',
    'PUT /admin/finance/affiliates/:id/self-employed',
  ],
};

const jwt = new JwtService({ secret: 'be05-route-roles-test' });
const reflector = new Reflector();
const BLOCKED = 'blocked-user';
// identity: bloklangan (authVersion oshgan) foydalanuvchi tokeni — 401 (C6.5, `identity.user.authorize-token`).
const identity = {
  send: jest.fn((_pattern: unknown, data: { userId: string }) =>
    data.userId === BLOCKED
      ? throwError(() => ({ status: 401, message: 'Token bekor qilingan' }))
      : of({ authorized: true }),
  ),
};
const guards = [
  new JwtAuthGuard(jwt, reflector),
  new CurrentRoleGuard(reflector, identity as never),
  new RolesGuard(reflector),
];

/** Guard zanjiri natijasi: 200 (o‘tdi), 401 yoki 403. */
async function statusOf(
  route: RouteInfo,
  token?: { sub: string; role: Role },
): Promise<number> {
  const request = {
    method: route.key.split(' ')[0],
    headers: token
      ? { authorization: `Bearer ${jwt.sign({ ...token, authVersion: 1 })}` }
      : {},
  };
  const context = {
    getHandler: () => route.handler,
    getClass: () => route.cls,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  try {
    for (const guard of guards) await guard.canActivate(context);
    return 200;
  } catch (error) {
    if (error instanceof HttpException) return error.getStatus();
    throw error;
  }
}

async function reachable(role: Role): Promise<string[]> {
  const open: string[] = [];
  for (const route of routes) {
    if (route.isPublic) continue;
    if ((await statusOf(route, { sub: '7', role })) === 200)
      open.push(route.key);
  }
  return open;
}

describe('BE-05: gateway yo‘llari va rollar', () => {
  it('yo‘llar topildi', () => {
    expect(routes.length).toBeGreaterThan(200);
  });

  it('har bir yo‘l ochiq (@Public), rolli (@Roles) yoki ANY_SIGNED_IN ro‘yxatida', () => {
    const open = routes
      .filter((route) => !route.isPublic && !route.roles?.length)
      .map((route) => route.key);
    expect(open).toEqual(ANY_SIGNED_IN);
  });

  it('TC6: tokensiz har bir yopiq yo‘l — 401 (sellers/*, admin/shops/* ham)', async () => {
    const statuses = new Map<string, number>();
    for (const route of routes.filter((r) => !r.isPublic))
      statuses.set(route.key, await statusOf(route));
    expect([...statuses.values()].every((status) => status === 401)).toBe(true);
    expect(statuses.get('GET /sellers/me')).toBe(401);
    expect(statuses.get('GET /admin/shops')).toBe(401);
  });

  it('TC6: eski do‘kon yo‘llari (LegacyRole) yangi rollarning hech biriga ochilmaydi — 403', async () => {
    const legacy = routes.filter(
      (route) =>
        !route.isPublic &&
        route.roles?.length &&
        route.roles.every((role) =>
          Object.values(LegacyRole).includes(role as LegacyRole),
        ),
    );
    expect(legacy.map((route) => route.key)).toEqual(
      expect.arrayContaining([
        'GET /sellers/me',
        'GET /seller/orders',
        'POST /products',
        'GET /orders',
        'POST /payments',
        'POST /guest/merge',
        // karta: «admin/shops/* yangi rollar bilan ochilmaydi»
        'GET /admin/shops',
        'POST /admin/shops/:id/approve',
      ]),
    );
    for (const route of legacy)
      for (const role of Object.values(Role))
        expect([
          route.key,
          role,
          await statusOf(route, { sub: '7', role }),
        ]).toEqual([route.key, role, 403]);
  });

  it.each(Object.keys(EXPECTED) as Role[])(
    'Har rol uchun guard: %s — faqat TZ jadvalidagi yo‘llar',
    async (role) => {
      expect(await reachable(role)).toEqual(
        [...EXPECTED[role]!, ...ANY_SIGNED_IN].sort((a, b) =>
          a.localeCompare(b),
        ),
      );
    },
  );

  it('sotuvchi kabineti yo‘llari bor (BE-11, BE-23, BE-28, BE-43)', () => {
    expect(EXPECTED[Role.AFFILIATE]).toEqual(
      expect.arrayContaining([
        'GET /affiliate/offers',
        'POST /affiliate/streams',
        'GET /affiliate/leads',
        'POST /affiliate/withdrawals',
        'POST /affiliate/api-keys',
      ]),
    );
  });

  it('TC2: AFFILIATE token bilan admin API — 403 (har bir /admin yo‘li)', async () => {
    const admin = routes.filter(
      (route) => !route.isPublic && route.key.includes(' /admin/'),
    );
    expect(admin.length).toBeGreaterThan(50);
    for (const route of admin)
      expect([
        route.key,
        await statusOf(route, { sub: '7', role: Role.AFFILIATE }),
      ]).toEqual([route.key, 403]);
  });

  it('ADMIN va SUPERADMIN: sotuvchi kabineti va eski yo‘llar yopiq; superadmin admin qila oladigan hamma narsani qiladi', async () => {
    const admin = await reachable(Role.ADMIN);
    const superadmin = await reachable(Role.SUPERADMIN);
    for (const open of [admin, superadmin]) {
      expect(open.filter((key) => key.includes(' /affiliate/'))).toEqual([]);
      expect(open).not.toContain('GET /sellers/me');
      expect(open).not.toContain('POST /payments');
    }
    expect(admin.filter((key) => !superadmin.includes(key))).toEqual([]);
    // TZ: «Lidni bron qilish» — admin emas; navbat xulosasi — ha
    expect(admin).not.toContain('POST /operator/leads/next');
    expect(admin).toContain('GET /operator/queue-summary');
    expect(superadmin).toContain('POST /operator/leads/next');
    // Pul tasdiqlash va bank fayli (aktlarni muzlatadi) — moliya va superadmin, admin emas
    expect(admin).not.toContain('POST /admin/finance/withdrawals/:id/approve');
    expect(admin).not.toContain('GET /admin/finance/settlements/bank-file');
    expect(admin).toContain('POST /admin/leads/:id/reopen');
    expect(admin.filter((key) => key.includes(' /admin/shops'))).toEqual([]);
  });

  it('ADMIN va SUPERADMIN ro‘yxati qotirilgan (snapshot): yangi yo‘l yoki rol o‘zgarishi ko‘rib chiqiladi', async () => {
    expect({
      ADMIN: await reachable(Role.ADMIN),
      SUPERADMIN: await reachable(Role.SUPERADMIN),
    }).toMatchSnapshot();
  });

  it('bloklangan foydalanuvchi tokeni (authVersion eskirgan) har bir yopiq yo‘lda darhol 401 — rolsiz yo‘llarda ham; faqat logout ishlaydi', async () => {
    const logout = routes.find((r) => r.key === 'POST /auth/logout')!;
    expect(await statusOf(logout, { sub: BLOCKED, role: Role.AFFILIATE })).toBe(
      200,
    );
    for (const route of routes.filter((r) => !r.isPublic && r !== logout))
      expect([
        route.key,
        await statusOf(route, { sub: BLOCKED, role: Role.AFFILIATE }),
      ]).toEqual([route.key, 401]);
    expect(routes.filter((r) => ANY_SIGNED_IN.includes(r.key)).length).toBe(
      ANY_SIGNED_IN.length,
    );
  });

  it('bloklangan token: sotuvchi va operator yo‘llari 401, faol token — o‘tadi', async () => {
    const affiliate = routes.find(
      (route) => route.key === 'POST /affiliate/streams',
    )!;
    const operator = routes.find(
      (route) => route.key === 'POST /operator/leads/next',
    )!;
    expect(
      await statusOf(affiliate, { sub: BLOCKED, role: Role.AFFILIATE }),
    ).toBe(401);
    expect(
      await statusOf(operator, { sub: BLOCKED, role: Role.OPERATOR_LEAD }),
    ).toBe(401);
    expect(await statusOf(affiliate, { sub: '7', role: Role.AFFILIATE })).toBe(
      200,
    );
  });
});
