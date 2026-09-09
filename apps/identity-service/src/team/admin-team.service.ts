import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ActivityLog,
  CreateAdminTeamMemberDto,
  Role,
  UpdateAdminTeamRoleDto,
} from '@app/common';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { DataSource, EntityManager, In, IsNull, Repository } from 'typeorm';
import { AuthSession } from '../entities/auth-session.entity';
import { User } from '../entities/user.entity';

const BCRYPT_ROUNDS = 10;
const TEAM_ROLES = [Role.ADMIN, Role.SUPERADMIN];

@Injectable()
export class AdminTeamService {
  constructor(private readonly dataSource: DataSource) {}

  async list(actorId: string) {
    const users = this.dataSource.getRepository(User);
    await this.assertSuperadmin(users, actorId);
    const rows = await users.find({
      where: { role: In(TEAM_ROLES), isDeleted: false },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
    return rows.map((user) => this.view(user));
  }

  async create(actorId: string, dto: CreateAdminTeamMemberDto, ip?: string) {
    this.assertTeamRole(dto?.role);
    const password = dto.password ?? randomBytes(12).toString('base64url');
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    return this.dataSource.transaction(async (manager) => {
      await this.lockTeam(manager);
      const users = manager.getRepository(User);
      await this.assertSuperadmin(users, actorId);
      const duplicate = await users.findOne({ where: { phone: dto.phone } });
      if (duplicate) {
        throw new ConflictException('Bu telefon allaqachon ro‘yxatdan o‘tgan');
      }

      const saved = await users.save(
        users.create({
          name: dto.name.trim(),
          phone: dto.phone,
          email: null,
          passwordHash,
          role: dto.role,
          isActive: true,
          isBlocked: false,
          isDeleted: false,
          shopId: null,
        }),
      );
      await this.audit(manager, actorId, 'admin.team.create', saved.id, {
        before: null,
        after: this.view(saved),
        ip: ip ?? null,
      });
      return {
        ...this.view(saved),
        ...(dto.password ? {} : { temporaryPassword: password }),
      };
    });
  }

  async updateRole(
    actorId: string,
    memberId: string,
    dto: UpdateAdminTeamRoleDto,
    ip?: string,
  ) {
    this.assertTeamRole(dto?.role);
    return this.dataSource.transaction(async (manager) => {
      await this.lockTeam(manager);
      const users = manager.getRepository(User);
      await this.assertSuperadmin(users, actorId);
      const member = await this.member(users, memberId);
      if (member.role === dto.role) return this.view(member);
      if (member.role === Role.SUPERADMIN && dto.role !== Role.SUPERADMIN) {
        await this.assertNotLastSuperadmin(users);
      }

      const before = this.view(member);
      member.role = dto.role;
      const saved = await users.save(member);
      await this.revokeSessions(manager, member.id);
      await this.audit(manager, actorId, 'admin.team.role.update', member.id, {
        before,
        after: this.view(saved),
        ip: ip ?? null,
      });
      return this.view(saved);
    });
  }

  async remove(actorId: string, memberId: string, ip?: string) {
    return this.dataSource.transaction(async (manager) => {
      await this.lockTeam(manager);
      const users = manager.getRepository(User);
      await this.assertSuperadmin(users, actorId);
      const member = await this.member(users, memberId);
      if (member.role === Role.SUPERADMIN) {
        await this.assertNotLastSuperadmin(users);
      }

      const before = this.view(member);
      member.isDeleted = true;
      member.isActive = false;
      member.isBlocked = true;
      await users.save(member);
      await this.revokeSessions(manager, member.id);
      await this.audit(manager, actorId, 'admin.team.delete', member.id, {
        before,
        after: { id: member.id, removed: true },
        ip: ip ?? null,
      });
      return { id: member.id, removed: true };
    });
  }

  private async member(users: Repository<User>, memberId: string) {
    const member = await users.findOne({
      where: { id: String(memberId), role: In(TEAM_ROLES), isDeleted: false },
      lock: { mode: 'pessimistic_write' },
    });
    if (!member) throw new NotFoundException('Jamoa a’zosi topilmadi');
    return member;
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

  private async assertNotLastSuperadmin(users: Repository<User>) {
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
        'Oxirgi SUPERADMINni o‘chirib yoki pasaytirib bo‘lmaydi',
      );
    }
  }

  private assertTeamRole(role: Role) {
    if (!TEAM_ROLES.includes(role)) {
      throw new BadRequestException(
        'Jamoa roli ADMIN yoki SUPERADMIN bo‘lishi kerak',
      );
    }
  }

  private lockTeam(manager: EntityManager) {
    return manager.query(
      `SELECT pg_advisory_xact_lock(hashtext('identity-admin-team'))`,
    );
  }

  private revokeSessions(manager: EntityManager, userId: string) {
    return manager
      .getRepository(AuthSession)
      .update({ userId, revokedAt: IsNull() }, { revokedAt: new Date() });
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
        entityType: 'AdminTeamMember',
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
      role: user.role as Role.ADMIN | Role.SUPERADMIN,
      isActive: user.isActive,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}
