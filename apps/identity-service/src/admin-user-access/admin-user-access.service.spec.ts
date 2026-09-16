import {
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ActivityLog, Role } from '@app/common';
import { AuthSession } from '../entities/auth-session.entity';
import { User } from '../entities/user.entity';
import { AdminUserAccessService } from './admin-user-access.service';

describe('AdminUserAccessService (C6.5)', () => {
  function setup() {
    const now = new Date('2026-09-16T00:00:00.000Z');
    const usersStore = [
      {
        id: '1',
        name: 'Owner',
        phone: '+998900000001',
        role: Role.SUPERADMIN,
        isActive: true,
        isBlocked: false,
        isDeleted: false,
        authVersion: 1,
        shopId: null,
        email: null,
        avatarUrl: null,
        passwordHash: 'hash',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: '2',
        name: 'Seller',
        phone: '+998900000002',
        role: Role.SELLER,
        isActive: true,
        isBlocked: false,
        isDeleted: false,
        authVersion: 1,
        shopId: null,
        email: null,
        avatarUrl: null,
        passwordHash: 'hash',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: '3',
        name: 'Admin',
        phone: '+998900000003',
        role: Role.ADMIN,
        isActive: true,
        isBlocked: false,
        isDeleted: false,
        authVersion: 1,
        shopId: null,
        email: null,
        avatarUrl: null,
        passwordHash: 'hash',
        createdAt: now,
        updatedAt: now,
      },
    ] as User[];
    const auditRows: Array<Record<string, any>> = [];
    const sessionUpdate = jest.fn(async () => ({ affected: 1 }));
    const users = {
      findOne: jest.fn(async ({ where }) =>
        usersStore.find(
          (user) =>
            (where.id === undefined || user.id === String(where.id)) &&
            (where.role === undefined || user.role === where.role) &&
            (where.isActive === undefined ||
              user.isActive === where.isActive) &&
            (where.isBlocked === undefined ||
              user.isBlocked === where.isBlocked) &&
            (where.isDeleted === undefined ||
              user.isDeleted === where.isDeleted),
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
      save: jest.fn(async (user: User) => user),
    };
    const logs = {
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => {
        auditRows.push(value);
        return value;
      }),
    };
    const manager = {
      query: jest.fn(async () => []),
      getRepository: jest.fn((entity) => {
        if (entity === User) return users;
        if (entity === AuthSession) return { update: sessionUpdate };
        if (entity === ActivityLog) return logs;
        throw new Error('Unexpected entity');
      }),
    };
    const dataSource = {
      getRepository: jest.fn(() => users),
      transaction: jest.fn(async (work) => work(manager)),
    };
    const jwt = new JwtService({ secret: 'test-access-secret' });
    return {
      usersStore,
      auditRows,
      sessionUpdate,
      jwt,
      service: new AdminUserAccessService(dataSource as never, jwt),
    };
  }

  it('TC1: rolni o‘zgartiradi, sessiyalarni bekor qiladi va audit yozadi', async () => {
    const { service, sessionUpdate, auditRows } = setup();

    const result = await service.updateRole(
      '1',
      '2',
      { role: Role.BUYER },
      '1.2.3.4',
    );
    expect(result).toMatchObject({ id: '2', role: Role.BUYER });
    await expect(
      service.authorizeToken('2', Role.SELLER, 1),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.authorizeToken('2', Role.BUYER, 2)).resolves.toEqual({
      authorized: true,
    });
    expect(sessionUpdate).toHaveBeenCalledTimes(1);
    expect(auditRows[0]).toMatchObject({
      actorId: '1',
      action: 'user.role.update',
      entityType: 'User',
      entityId: '2',
      meta: expect.objectContaining({
        before: expect.objectContaining({ role: Role.SELLER }),
        after: expect.objectContaining({ role: Role.BUYER }),
        ip: '1.2.3.4',
      }),
    });
  });

  it('TC2/TC3/TC4: 15 daqiqalik impersonation token beradi va audit yozadi', async () => {
    const { service, jwt, auditRows } = setup();

    const result = await service.impersonate('1', '2', '5.6.7.8');
    const payload = jwt.verify(result.impersonationToken) as {
      sub: string;
      role: Role;
      impersonatedBy: string;
      tokenType: string;
      authVersion: number;
      iat: number;
      exp: number;
    };

    expect(payload).toMatchObject({
      sub: '2',
      role: Role.SELLER,
      impersonatedBy: '1',
      tokenType: 'impersonation',
      authVersion: 1,
    });
    expect(payload.exp - payload.iat).toBe(900);
    expect(() =>
      jwt.verify(result.impersonationToken, {
        clockTimestamp: payload.exp + 1,
      }),
    ).toThrow();
    expect(auditRows[0]).toMatchObject({
      actorId: '1',
      action: 'user.impersonate',
      entityId: '2',
      meta: expect.objectContaining({
        durationSeconds: 900,
        ip: '5.6.7.8',
      }),
    });
  });

  it('TC5: oddiy ADMIN impersonation va rol o‘zgartirishni bajara olmaydi', async () => {
    const { service } = setup();

    await expect(service.impersonate('3', '2')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(
      service.updateRole('3', '2', { role: Role.BUYER }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('oxirgi SUPERADMINni pasaytirishni bloklaydi', async () => {
    const { service } = setup();

    await expect(
      service.updateRole('1', '1', { role: Role.ADMIN }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('admin yoki superadmin akkauntini impersonate qilishni bloklaydi', async () => {
    const { service } = setup();

    await expect(service.impersonate('1', '3')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
