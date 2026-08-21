import {
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ClientProxy } from '@nestjs/microservices';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, QueryFailedError, Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { createHash, randomUUID } from 'crypto';
import { firstValueFrom } from 'rxjs';
import {
  BusinessException,
  LoginDto,
  RegisterDto,
  Role,
  RmqClient,
  SellerRegisterDto,
  ShopStatus,
  UpdateProfileDto,
} from '@app/common';
import { User } from '../entities/user.entity';
import { AuthSession } from '../entities/auth-session.entity';

const BCRYPT_ROUNDS = 10;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(AuthSession)
    private readonly sessions: Repository<AuthSession>,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly dataSource: DataSource,
    @Inject(RmqClient.NOTIFICATION)
    private readonly notifications: ClientProxy,
  ) {}

  async register(dto: RegisterDto) {
    const exists = await this.users.findOne({ where: { phone: dto.phone } });
    if (exists) {
      throw BusinessException.conflict(
        "Bu telefon raqam allaqachon ro'yxatdan o'tgan",
      );
    }
    const role = dto.role ?? Role.BUYER;
    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    const user = await this.users.save(
      this.users.create({
        name: dto.name,
        phone: dto.phone,
        email: dto.email ?? null,
        passwordHash,
        role,
        // SELLER admin tasdig'igacha nofaol; BUYER darrov faol
        isActive: role !== Role.SELLER,
      }),
    );
    return this.buildAuthResult(user);
  }

  async login(dto: LoginDto) {
    const user = await this.users.findOne({ where: { phone: dto.phone } });
    // Bir xil xabar — foydalanuvchi mavjudligini oshkor qilmaslik uchun
    if (!user || !(await bcrypt.compare(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('Telefon yoki parol xato');
    }
    // C1.29 — bloklangan foydalanuvchi tizimga kira olmaydi.
    if (user.isBlocked) {
      throw new UnauthorizedException('Hisobingiz bloklangan');
    }
    return this.buildAuthResult(user);
  }

  async getById(userId: string) {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw BusinessException.conflict('Foydalanuvchi topilmadi');
    return this.sanitize(user);
  }

  /** Foydalanuvchini faollashtiradi/o'chiradi (admin approve/reject). */
  async setActive(userId: string, isActive: boolean) {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw BusinessException.conflict('Foydalanuvchi topilmadi');
    user.isActive = isActive;
    const saved = await this.users.save(user);
    return this.sanitize(saved);
  }

  /**
   * C1.28 — foydalanuvchilar sonini rol bo'yicha (admin dashboard uchun). Yangi
   * platformada barcha son 0.
   */
  async countUsersByRole(): Promise<{
    total: number;
    SELLER: number;
    BUYER: number;
    ADMIN: number;
    OPERATOR: number;
    SUPERADMIN: number;
  }> {
    const rows = await this.users
      .createQueryBuilder('u')
      .select('u.role', 'role')
      .addSelect('COUNT(*)', 'count')
      .where('u.is_deleted = FALSE')
      .groupBy('u.role')
      .getRawMany<{ role: string; count: string }>();

    const base = { SELLER: 0, BUYER: 0, ADMIN: 0, OPERATOR: 0, SUPERADMIN: 0 };
    let total = 0;
    for (const row of rows) {
      const n = Number(row.count);
      total += n;
      if (row.role in base) {
        base[row.role as keyof typeof base] = n;
      }
    }
    return { total, ...base };
  }

  /**
   * C1.29 — admin: foydalanuvchilar ro'yxati (rol/blok/qidiruv filtri +
   * pagination). Qidiruv ism yoki telefon bo'yicha. Parol hash chiqmaydi.
   */
  async adminListUsers(query: {
    role?: string;
    blocked?: boolean;
    search?: string;
    page?: number;
    limit?: number;
  }) {
    const page = Math.max(1, Number(query?.page ?? 1));
    const limit = Math.min(100, Math.max(1, Number(query?.limit ?? 20)));

    const qb = this.users.createQueryBuilder('u').where('u.is_deleted = FALSE');
    if (query?.role) {
      qb.andWhere('u.role = :role', { role: query.role });
    }
    if (query?.blocked !== undefined) {
      qb.andWhere('u.is_blocked = :blocked', { blocked: query.blocked });
    }
    if (query?.search?.trim()) {
      qb.andWhere('(u.name ILIKE :s OR u.phone ILIKE :s)', {
        s: `%${query.search.trim()}%`,
      });
    }
    qb.orderBy('u.created_at', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [rows, total] = await qb.getManyAndCount();
    return {
      items: rows.map((u) => this.sanitize(u)),
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  /** C1.29 — admin: bitta foydalanuvchi profili (parol hash chiqmaydi). */
  async adminGetUser(userId: string) {
    const user = await this.users.findOne({
      where: { id: String(userId), isDeleted: false },
    });
    if (!user) throw BusinessException.conflict('Foydalanuvchi topilmadi');
    return this.sanitize(user);
  }

  /** Admin profil/user ma'lumotlarini, zarur bo'lsa eski parolsiz yangilaydi. */
  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const user = await this.users.findOne({
      where: { id: String(userId), isDeleted: false },
    });
    if (!user) throw BusinessException.conflict('Foydalanuvchi topilmadi');

    if (dto.phone && dto.phone !== user.phone) {
      const duplicate = await this.users.findOne({
        where: { phone: dto.phone },
      });
      if (duplicate && String(duplicate.id) !== String(userId)) {
        throw BusinessException.conflict(
          "Bu telefon raqam allaqachon ro'yxatdan o'tgan",
        );
      }
      user.phone = dto.phone;
    }
    if (dto.name !== undefined) user.name = dto.name.trim();
    if (dto.email !== undefined) user.email = dto.email;
    if (dto.avatarUrl !== undefined) user.avatarUrl = dto.avatarUrl;

    if (dto.password) {
      user.passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    }
    const saved = await this.users.save(user);

    // Yangi parol o'rnatilgach o'g'irlangan/eski refresh tokenlar ishlamasin.
    if (dto.password) {
      await this.sessions.update(
        { userId: String(userId), revokedAt: IsNull() },
        { revokedAt: new Date() },
      );
    }
    return this.sanitize(saved);
  }

  /**
   * C1.29 — admin foydalanuvchini bloklaydi/blokdan chiqaradi. O'zini bloklab
   * bo'lmaydi (409). Bloklangan user login qila olmaydi (auth.login 401). Har
   * amal audit sifatida log'ga yoziladi.
   */
  async setBlocked(actorId: string, userId: string, blocked: boolean) {
    if (blocked && String(actorId) === String(userId)) {
      throw BusinessException.conflict("O'zingizni bloklay olmaysiz");
    }
    const user = await this.users.findOne({
      where: { id: String(userId), isDeleted: false },
    });
    if (!user) throw BusinessException.conflict('Foydalanuvchi topilmadi');

    user.isBlocked = blocked;
    const saved = await this.users.save(user);
    // Audit: kim kimni qachon (structured log).
    this.logger.log(
      `admin ${actorId} ${blocked ? 'blocked' : 'unblocked'} user ${userId}`,
    );
    return this.sanitize(saved);
  }

  // ===== Market operatorlari (C1.38) — do'kon xodimlari =====

  /** Sotuvchi o'z do'koniga operator qo'shadi (role=OPERATOR, shop_id, faol). */
  async createOperator(
    shopId: string,
    dto: { name: string; phone: string; password: string },
  ) {
    if (!shopId) throw BusinessException.invalidState('shopId majburiy');
    if (!dto?.name?.trim() || !dto?.phone?.trim() || !dto?.password) {
      throw BusinessException.invalidState('name, phone, password majburiy');
    }
    const exists = await this.users.findOne({ where: { phone: dto.phone } });
    if (exists) {
      throw BusinessException.conflict(
        'Bu telefon allaqachon ro‘yxatdan o‘tgan',
      );
    }
    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    const saved = await this.users.save(
      this.users.create({
        name: dto.name.trim(),
        phone: dto.phone.trim(),
        email: null,
        passwordHash,
        role: Role.OPERATOR,
        shopId: String(shopId),
        isActive: true,
      }),
    );
    return this.sanitize(saved);
  }

  /** Do'kon operatorlari ro'yxati. */
  async listOperators(shopId: string) {
    const ops = await this.users.find({
      where: { role: Role.OPERATOR, shopId: String(shopId), isDeleted: false },
      order: { createdAt: 'DESC' },
    });
    return ops.map((u) => this.sanitize(u));
  }

  /** Operatorni o'chiradi — faqat SHU do'konning operatori bo'lsa. */
  async removeOperator(shopId: string, operatorId: string) {
    const op = await this.users.findOne({
      where: {
        id: String(operatorId),
        role: Role.OPERATOR,
        shopId: String(shopId),
        isDeleted: false,
      },
    });
    if (!op) throw BusinessException.conflict('Operator topilmadi');
    op.isDeleted = true;
    op.isActive = false;
    await this.users.save(op);
    return { id: String(operatorId), removed: true };
  }

  async logout(userId: string): Promise<null> {
    await this.sessions.update(
      { userId, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
    return null;
  }

  async registerSeller(dto: SellerRegisterDto) {
    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    const slug = `${
      dto.shopName
        .normalize('NFKD')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 220) || 'shop'
    }-${dto.phone.replace(/\D/g, '').slice(-7)}`;

    let result: any;
    try {
      result = await this.dataSource.transaction(async (manager) => {
        const duplicate = await manager.query(
          `SELECT 1 FROM "identity"."users" WHERE "phone"=$1 LIMIT 1`,
          [dto.phone],
        );
        if (duplicate.length) {
          throw BusinessException.conflict(
            "Bu telefon raqam allaqachon ro'yxatdan o'tgan",
          );
        }
        const [user] = await manager.query(
          `INSERT INTO "identity"."users"
           ("role","name","phone","email","password_hash","avatar_url","is_active","is_deleted")
           VALUES ($1,$2,$3,$4,$5,NULL,FALSE,FALSE)
           RETURNING "id","name","phone","role","is_active" AS "isActive"`,
          [Role.SELLER, dto.name, dto.phone, dto.email ?? null, passwordHash],
        );
        const [shop] = await manager.query(
          `INSERT INTO "catalog"."shop"
           ("owner_user_id","name","slug","description","status","phone","address","rating","orders_count","is_deleted")
           VALUES ($1,$2,$3,$4,$5,$6,$7,0,0,FALSE)
           RETURNING "id","name","slug","status"`,
          [
            user.id,
            dto.shopName,
            slug,
            dto.shopDescription ?? null,
            ShopStatus.PENDING,
            dto.phone,
            dto.address ?? null,
          ],
        );
        return { user, shop };
      });
    } catch (error) {
      if (error instanceof BusinessException) throw error;
      if (
        error instanceof QueryFailedError &&
        (error as any).driverError?.code === '23505'
      ) {
        throw BusinessException.conflict(
          "Telefon yoki do'kon allaqachon mavjud",
        );
      }
      throw error;
    }

    try {
      await firstValueFrom(
        this.notifications.emit('seller.registration.created', {
          sellerUserId: result.user.id,
          shopId: result.shop.id,
          sellerName: result.user.name,
          shopName: result.shop.name,
          email: dto.email ?? null,
          phone: dto.phone,
        }),
      );
    } catch (error) {
      this.logger.warn(
        `Admin notification yuborilmadi: ${(error as Error).message}`,
      );
    }
    return result;
  }

  private async buildAuthResult(user: User) {
    // OPERATOR uchun shopId ham JWT'ga — gateway shu bo'yicha scope qiladi.
    const payload = {
      sub: user.id,
      role: user.role,
      shopId: user.shopId ?? undefined,
    };
    const accessToken = this.jwt.sign(payload, {
      expiresIn: this.config.get<string>('JWT_EXPIRES_IN', '1h') as any,
    });
    const sessionId = randomUUID();
    const refreshToken = this.jwt.sign(
      { ...payload, jti: sessionId },
      {
        secret: this.config.get<string>('JWT_REFRESH_SECRET'),
        expiresIn: this.config.get<string>(
          'JWT_REFRESH_EXPIRES_IN',
          '7d',
        ) as any,
      },
    );
    const decoded = this.jwt.decode(refreshToken) as { exp: number };
    await this.sessions.save(
      this.sessions.create({
        id: sessionId,
        userId: user.id,
        tokenHash: this.hashToken(refreshToken),
        expiresAt: new Date(decoded.exp * 1000),
        revokedAt: null,
      }),
    );
    return { user: this.sanitize(user), accessToken, refreshToken };
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private sanitize(user: User) {
    const { passwordHash, ...rest } = user;
    return rest;
  }
}
