import { ConflictException, ForbiddenException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { ActivityLog, Role } from '@app/common';
import { AuthService } from '../auth/auth.service';
import { AuthSession } from '../entities/auth-session.entity';
import { User } from '../entities/user.entity';
import { AdminTeamService } from './admin-team.service';

describe('AdminTeamService (C6.1)', () => {
  function setup(extraUsers: Partial<User>[] = []) {
    const now = new Date('2026-09-09T06:00:00.000Z');
    const usersStore = [
      {
        id: '1',
        name: 'Owner',
        phone: '+998900000001',
        passwordHash: 'hash',
        role: Role.SUPERADMIN,
        isActive: true,
        isBlocked: false,
        isDeleted: false,
        shopId: null,
        email: null,
        avatarUrl: null,
        createdAt: now,
        updatedAt: now,
      },
      ...extraUsers,
    ] as User[];
    let nextId = 10;
    const auditRows: Array<Record<string, unknown>> = [];
    const sessionUpdate = jest.fn(async () => ({ affected: 1 }));

    const matches = (user: User, where: Record<string, unknown>) => {
      if (where.id !== undefined && user.id !== String(where.id)) return false;
      if (where.phone !== undefined && user.phone !== where.phone) return false;
      if (where.role !== undefined && typeof where.role === 'string') {
        if (user.role !== where.role) return false;
      }
      for (const field of ['isActive', 'isBlocked', 'isDeleted'] as const) {
        if (where[field] !== undefined && user[field] !== where[field]) {
          return false;
        }
      }
      return true;
    };
    const users = {
      findOne: jest.fn(async ({ where }) => {
        const found = usersStore.find((user) => matches(user, where));
        if (!found || ![Role.ADMIN, Role.SUPERADMIN].includes(found.role)) {
          return null;
        }
        return found;
      }),
      find: jest.fn(async () =>
        usersStore.filter(
          (user) =>
            !user.isDeleted &&
            [Role.ADMIN, Role.SUPERADMIN].includes(user.role),
        ),
      ),
      count: jest.fn(
        async () =>
          usersStore.filter(
            (user) =>
              user.role === Role.SUPERADMIN &&
              user.isActive &&
              !user.isBlocked &&
              !user.isDeleted,
          ).length,
      ),
      create: jest.fn((value) => ({
        id: String(nextId++),
        createdAt: now,
        updatedAt: now,
        ...value,
      })),
      save: jest.fn(async (user: User) => {
        const index = usersStore.findIndex((stored) => stored.id === user.id);
        if (index === -1) usersStore.push(user);
        else usersStore[index] = user;
        return user;
      }),
    };
    const logs = {
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => {
        auditRows.push(value);
        return value;
      }),
    };
    const sessions = { update: sessionUpdate };
    const manager = {
      query: jest.fn(async () => []),
      getRepository: jest.fn((entity) => {
        if (entity === User) return users;
        if (entity === ActivityLog) return logs;
        if (entity === AuthSession) return sessions;
        throw new Error('Unexpected entity');
      }),
    };
    const dataSource = {
      getRepository: jest.fn(() => users),
      transaction: jest.fn(async (work) => work(manager)),
    };
    return {
      usersStore,
      users,
      auditRows,
      sessionUpdate,
      service: new AdminTeamService(dataSource as never),
    };
  }

  const admin = (id: string, role = Role.ADMIN): Partial<User> => ({
    id,
    name: `Admin ${id}`,
    phone: `+9989000000${id.padStart(2, '0')}`,
    passwordHash: 'hash',
    role,
    isActive: true,
    isBlocked: false,
    isDeleted: false,
    shopId: null,
    email: null,
    avatarUrl: null,
    createdAt: new Date('2026-09-09T06:00:00.000Z'),
    updatedAt: new Date('2026-09-09T06:00:00.000Z'),
  });

  it('TC1: faqat admin jamoasini parol hashisiz qaytaradi', async () => {
    const { service } = setup([admin('2')]);
    const result = await service.list('1');
    expect(result).toHaveLength(2);
    expect(result[1]).toMatchObject({ id: '2', role: Role.ADMIN });
    expect(result[1]).not.toHaveProperty('passwordHash');
  });

  it('TC2: yangi faol admin yaratadi va kirish parolini hash qiladi', async () => {
    const { service, users, usersStore, auditRows } = setup();
    const result = await service.create(
      '1',
      { name: 'New Admin', phone: '+998901112233', role: Role.ADMIN },
      '1.2.3.4',
    );
    const saved = usersStore.at(-1)!;

    expect(result).toMatchObject({
      id: saved.id,
      role: Role.ADMIN,
      isActive: true,
      temporaryPassword: expect.any(String),
    });
    expect(
      await bcrypt.compare(result.temporaryPassword!, saved.passwordHash),
    ).toBe(true);
    const auth = new AuthService(
      users as never,
      {
        create: (value: unknown) => value,
        save: async (value: unknown) => value,
      } as never,
      new JwtService({ secret: 'access-secret' }),
      {
        get: (key: string, fallback?: string) =>
          key === 'JWT_REFRESH_SECRET' ? 'refresh-secret' : fallback,
      } as never,
      {} as never,
      {} as never,
    );
    await expect(
      auth.login({
        phone: saved.phone,
        password: result.temporaryPassword!,
      }),
    ).resolves.toMatchObject({
      user: { id: saved.id, role: Role.ADMIN },
      accessToken: expect.any(String),
      refreshToken: expect.any(String),
    });
    expect(auditRows[0]).toMatchObject({
      action: 'admin.team.create',
      actorId: '1',
      meta: expect.objectContaining({ ip: '1.2.3.4' }),
    });
  });

  it('TC3: rol o‘zgarganda sessiyalar va eski SUPERADMIN ruxsati bekor bo‘ladi', async () => {
    const { service, sessionUpdate, auditRows } = setup([admin('2')]);
    await service.updateRole('1', '2', { role: Role.SUPERADMIN });
    await service.updateRole('2', '1', { role: Role.ADMIN });

    expect(sessionUpdate).toHaveBeenCalledTimes(2);
    await expect(service.list('1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(auditRows.map((row) => row.action)).toEqual([
      'admin.team.role.update',
      'admin.team.role.update',
    ]);
  });

  it('oxirgi SUPERADMINni pasaytirish yoki o‘chirishni bloklaydi', async () => {
    const { service } = setup();
    await expect(
      service.updateRole('1', '1', { role: Role.ADMIN }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(service.remove('1', '1')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('TC5: o‘chirishni auditga yozadi va sessiyani bekor qiladi', async () => {
    const { service, sessionUpdate, auditRows, usersStore } = setup([
      admin('2'),
    ]);
    await expect(service.remove('1', '2', '5.6.7.8')).resolves.toEqual({
      id: '2',
      removed: true,
    });
    expect(usersStore.find((user) => user.id === '2')).toMatchObject({
      isDeleted: true,
      isActive: false,
      isBlocked: true,
    });
    expect(sessionUpdate).toHaveBeenCalledTimes(1);
    expect(auditRows[0]).toMatchObject({
      action: 'admin.team.delete',
      actorId: '1',
      meta: expect.objectContaining({ ip: '5.6.7.8' }),
    });
  });

  it('TC4: oddiy ADMIN servis qatlamida ham rad etiladi', async () => {
    const { service } = setup([admin('2')]);
    await expect(service.list('2')).rejects.toBeInstanceOf(ForbiddenException);
  });
});
