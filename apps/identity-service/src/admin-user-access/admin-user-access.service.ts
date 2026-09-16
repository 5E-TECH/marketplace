import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ActivityLog, Role, UpdateUserRoleDto } from '@app/common';
import { randomUUID } from 'crypto';
import { DataSource, EntityManager, IsNull, Repository } from 'typeorm';
import { AuthSession } from '../entities/auth-session.entity';
import { User } from '../entities/user.entity';

const IMPERSONATION_TTL_SECONDS = 15 * 60;
const MANAGEABLE_ROLES = [Role.BUYER, Role.SELLER, Role.ADMIN, Role.SUPERADMIN];
const IMPERSONATABLE_ROLES = [Role.BUYER, Role.SELLER, Role.OPERATOR];

@Injectable()
export class AdminUserAccessService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly jwt: JwtService,
  ) {}

  async updateRole(
    actorId: string,
    userId: string,
    dto: UpdateUserRoleDto,
    ip?: string,
  ) {
    if (!MANAGEABLE_ROLES.includes(dto?.role)) {
      throw new BadRequestException(
        'Rol BUYER, SELLER, ADMIN yoki SUPERADMIN bo‘lishi kerak',
      );
    }

    return this.dataSource.transaction(async (manager) => {
      await manager.query(
        `SELECT pg_advisory_xact_lock(hashtext('identity-user-role'))`,
      );
      const users = manager.getRepository(User);
      await this.assertSuperadmin(users, actorId);
      const user = await this.getUser(users, userId);
      if (user.role === dto.role) return this.view(user);

      if (user.role === Role.SUPERADMIN && dto.role !== Role.SUPERADMIN) {
        const count = await users.count({
          where: {
            role: Role.SUPERADMIN,
            isActive: true,
            isBlocked: false,
            isDeleted: false,
          },
        });
        if (count <= 1) {
          throw new ConflictException(
            'Oxirgi SUPERADMINni pasaytirib bo‘lmaydi',
          );
        }
      }

      const before = this.view(user);
      user.role = dto.role;
      user.authVersion = (user.authVersion ?? 1) + 1;
      // OPERATOR scope'i alohida seller endpointi orqali boshqariladi.
      user.shopId = null;
      const saved = await users.save(user);
      await manager
        .getRepository(AuthSession)
        .update(
          { userId: user.id, revokedAt: IsNull() },
          { revokedAt: new Date() },
        );
      await this.audit(manager, actorId, 'user.role.update', user.id, {
        before,
        after: this.view(saved),
        ip: ip ?? null,
      });
      return this.view(saved);
    });
  }

  async impersonate(actorId: string, userId: string, ip?: string) {
    return this.dataSource.transaction(async (manager) => {
      const users = manager.getRepository(User);
      await this.assertSuperadmin(users, actorId);
      const user = await this.getUser(users, userId);

      if (String(actorId) === String(user.id)) {
        throw new ConflictException('O‘zingizning nomingizdan kirib bo‘lmaydi');
      }
      if (!IMPERSONATABLE_ROLES.includes(user.role)) {
        throw new ForbiddenException(
          'ADMIN yoki SUPERADMIN nomidan kirish taqiqlangan',
        );
      }
      if (!user.isActive || user.isBlocked) {
        throw new ConflictException(
          'Faol bo‘lmagan hisob nomidan kirib bo‘lmaydi',
        );
      }

      const impersonationToken = this.jwt.sign(
        {
          sub: user.id,
          role: user.role,
          shopId: user.shopId ?? undefined,
          impersonatedBy: String(actorId),
          tokenType: 'impersonation',
          authVersion: user.authVersion ?? 1,
          jti: randomUUID(),
        },
        { expiresIn: IMPERSONATION_TTL_SECONDS },
      );
      const decoded = this.jwt.decode(impersonationToken) as { exp: number };
      const expiresAt = new Date(decoded.exp * 1000);

      await this.audit(manager, actorId, 'user.impersonate', user.id, {
        targetRole: user.role,
        durationSeconds: IMPERSONATION_TTL_SECONDS,
        expiresAt: expiresAt.toISOString(),
        ip: ip ?? null,
      });

      return {
        impersonationToken,
        expiresIn: IMPERSONATION_TTL_SECONDS,
        expiresAt,
        user: this.impersonatedUser(user),
      };
    });
  }

  async authorizeToken(
    userId: string,
    tokenRole: Role,
    tokenAuthVersion?: number,
  ): Promise<{ authorized: true }> {
    const user = await this.dataSource.getRepository(User).findOne({
      where: { id: String(userId), isDeleted: false },
    });
    if (
      !user ||
      user.isBlocked ||
      user.role !== tokenRole ||
      (user.authVersion ?? 1) !== Number(tokenAuthVersion)
    ) {
      throw new UnauthorizedException(
        'Token bekor qilingan, qayta tizimga kiring',
      );
    }
    return { authorized: true };
  }

  private async assertSuperadmin(users: Repository<User>, actorId: string) {
    const actor = await users.findOne({
      where: {
        id: String(actorId),
        role: Role.SUPERADMIN,
        isActive: true,
        isBlocked: false,
        isDeleted: false,
      },
    });
    if (!actor) throw new ForbiddenException('Faqat SUPERADMIN uchun');
  }

  private async getUser(users: Repository<User>, userId: string) {
    const user = await users.findOne({
      where: { id: String(userId), isDeleted: false },
      lock: { mode: 'pessimistic_write' },
    });
    if (!user) throw new NotFoundException('Foydalanuvchi topilmadi');
    return user;
  }

  private audit(
    manager: EntityManager,
    actorId: string,
    action: string,
    entityId: string,
    meta: unknown,
  ) {
    const logs = manager.getRepository(ActivityLog);
    return logs.save(
      logs.create({
        actorId,
        action,
        entityType: 'User',
        entityId,
        meta,
      }),
    );
  }

  private view(user: User) {
    return {
      id: String(user.id),
      name: user.name,
      phone: user.phone,
      email: user.email,
      role: user.role,
      shopId: user.shopId,
      isActive: user.isActive,
      isBlocked: user.isBlocked,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  private impersonatedUser(user: User) {
    return {
      id: String(user.id),
      name: user.name,
      role: user.role,
      shopId: user.shopId,
    };
  }
}
