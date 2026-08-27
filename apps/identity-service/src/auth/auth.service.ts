import {
  BadRequestException,
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
  CreateSupportTicketDto,
  ForgotPasswordDto,
  LoginDto,
  RegisterDto,
  ResetPasswordDto,
  Role,
  RmqClient,
  SellerRegisterDto,
  ShopStatus,
  UpdateProfileDto,
  VerifyPhoneDto,
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

  /** Faqat shu do‘konga tegishli operator profilini yangilaydi. */
  async updateOperator(
    shopId: string,
    operatorId: string,
    dto: {
      name?: string;
      phone?: string;
      password?: string;
      isActive?: boolean;
    },
  ) {
    const operator = await this.users.findOne({
      where: {
        id: String(operatorId),
        role: Role.OPERATOR,
        shopId: String(shopId),
        isDeleted: false,
      },
    });
    if (!operator) throw BusinessException.conflict('Operator topilmadi');
    if (!dto || Object.values(dto).every((value) => value === undefined)) {
      throw BusinessException.invalidState(
        'Kamida bitta o‘zgartiriladigan maydon kerak',
      );
    }

    if (dto.phone !== undefined && dto.phone.trim() !== operator.phone) {
      const phoneOwner = await this.users.findOne({
        where: { phone: dto.phone.trim() },
      });
      if (phoneOwner) {
        throw BusinessException.conflict(
          'Bu telefon allaqachon ro‘yxatdan o‘tgan',
        );
      }
      operator.phone = dto.phone.trim();
    }
    if (dto.name !== undefined) operator.name = dto.name.trim();
    if (dto.password !== undefined) {
      operator.passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
      await this.sessions.update(
        { userId: operator.id, revokedAt: IsNull() },
        { revokedAt: new Date() },
      );
    }
    if (dto.isActive !== undefined) operator.isActive = dto.isActive;

    return this.sanitize(await this.users.save(operator));
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

  async refresh(refreshToken: string) {
    if (!refreshToken)
      throw new UnauthorizedException('Refresh token topilmadi');
    let payload: { sub: string; jti: string; role: Role; shopId?: string };
    try {
      payload = await this.jwt.verifyAsync(refreshToken, {
        secret: this.config.get<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException(
        'Refresh token yaroqsiz yoki muddati tugagan',
      );
    }
    const session = await this.sessions.findOne({ where: { id: payload.jti } });
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt <= new Date() ||
      session.tokenHash !== this.hashToken(refreshToken)
    ) {
      throw new UnauthorizedException('Sessiya bekor qilingan');
    }
    session.revokedAt = new Date(); // rotation: eski token qayta ishlatilmaydi
    await this.sessions.save(session);
    const user = await this.users.findOne({
      where: { id: payload.sub, isDeleted: false },
    });
    if (!user || !user.isActive || user.isBlocked)
      throw new UnauthorizedException('Hisob faol emas');
    return this.buildAuthResult(user);
  }

  async createVerificationCode(
    dto: ForgotPasswordDto,
    purpose = 'PASSWORD_RESET',
  ) {
    const user = await this.users.findOne({
      where: { phone: dto.phone, isDeleted: false },
    });
    // Enumerationdan himoya: user topilmasa ham bir xil javob.
    if (!user) return { sent: true, expiresIn: 300 };
    const code = String(Math.floor(100000 + Math.random() * 900000));
    await this.dataSource.query(
      `INSERT INTO identity.verification_code(id, phone, purpose, code_hash, expires_at)
       VALUES ($1,$2,$3,$4,now() + interval '5 minutes')`,
      [randomUUID(), dto.phone, purpose, this.hashToken(code)],
    );
    this.notifications.emit('auth.verification-code.requested', {
      phone: dto.phone,
      code,
      purpose,
    });
    return { sent: true, expiresIn: 300 };
  }

  private async consumeCode(phone: string, code: string, purpose: string) {
    const rows = await this.dataSource.query(
      `UPDATE identity.verification_code SET used_at=now() WHERE id=(
       SELECT id FROM identity.verification_code WHERE phone=$1 AND purpose=$2 AND used_at IS NULL
       AND expires_at>now() ORDER BY created_at DESC LIMIT 1) AND code_hash=$3 RETURNING id`,
      [phone, purpose, this.hashToken(code)],
    );
    if (!rows.length)
      throw new BadRequestException(
        'Tasdiqlash kodi noto‘g‘ri yoki muddati tugagan',
      );
  }

  async resetPassword(dto: ResetPasswordDto) {
    await this.consumeCode(dto.phone, dto.code, 'PASSWORD_RESET');
    const user = await this.users.findOne({
      where: { phone: dto.phone, isDeleted: false },
    });
    if (!user)
      throw new BadRequestException(
        'Tasdiqlash kodi noto‘g‘ri yoki muddati tugagan',
      );
    user.passwordHash = await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS);
    await this.users.save(user);
    await this.logout(user.id);
    return { reset: true };
  }

  async verifyPhone(dto: VerifyPhoneDto) {
    await this.consumeCode(dto.phone, dto.code, 'PHONE_VERIFY');
    await this.dataSource.query(
      `UPDATE identity.users SET phone_verified_at=now(), updated_at=now() WHERE phone=$1 AND is_deleted=FALSE`,
      [dto.phone],
    );
    return { verified: true };
  }

  async listSessions(userId: string) {
    const rows = await this.sessions.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
    return rows.map((s) => ({
      id: s.id,
      createdAt: s.createdAt,
      expiresAt: s.expiresAt,
      current: false,
      active: !s.revokedAt && s.expiresAt > new Date(),
    }));
  }

  async revokeSession(userId: string, id: string) {
    const result = await this.sessions.update(
      { id, userId, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
    if (!result.affected) throw new BadRequestException('Sessiya topilmadi');
    return { id, revoked: true };
  }

  async createTicket(userId: string, dto: CreateSupportTicketDto) {
    return this.dataSource.transaction(async (m) => {
      const [ticket] = await m.query(
        `INSERT INTO identity.support_ticket(user_id,subject,order_id) VALUES($1,$2,$3) RETURNING id,subject,order_id AS "orderId",status,created_at AS "createdAt",updated_at AS "updatedAt"`,
        [userId, dto.subject.trim(), dto.orderId ?? null],
      );
      const [message] = await m.query(
        `INSERT INTO identity.support_message(ticket_id,sender_user_id,message) VALUES($1,$2,$3) RETURNING id,message,created_at AS "createdAt"`,
        [ticket.id, userId, dto.message.trim()],
      );
      return { ...ticket, message };
    });
  }
  async listTickets(
    userId: string,
    query: { status?: string; page?: number; limit?: number },
  ) {
    const page = query.page ?? 1,
      limit = query.limit ?? 20,
      params: unknown[] = [userId];
    let where = 'user_id=$1';
    if (query.status) {
      params.push(query.status);
      where += ` AND status=$${params.length}`;
    }
    const [count] = await this.dataSource.query(
      `SELECT COUNT(*)::int total FROM identity.support_ticket WHERE ${where}`,
      params,
    );
    const rows = await this.dataSource.query(
      `SELECT id,subject,order_id AS "orderId",status,created_at AS "createdAt",updated_at AS "updatedAt" FROM identity.support_ticket WHERE ${where} ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, (page - 1) * limit],
    );
    const total = Number(count?.total ?? 0);
    return {
      items: rows,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }
  async getTicket(userId: string, id: string) {
    const [ticket] = await this.dataSource.query(
      `SELECT id,subject,order_id AS "orderId",status,created_at AS "createdAt",updated_at AS "updatedAt" FROM identity.support_ticket WHERE id=$1 AND user_id=$2`,
      [id, userId],
    );
    if (!ticket) throw new BadRequestException('Murojaat topilmadi');
    ticket.messages = await this.dataSource.query(
      `SELECT id,sender_user_id AS "senderUserId",message,created_at AS "createdAt" FROM identity.support_message WHERE ticket_id=$1 ORDER BY created_at`,
      [id],
    );
    return ticket;
  }
  async addTicketMessage(userId: string, id: string, message: string) {
    await this.getTicket(userId, id);
    const [row] = await this.dataSource.query(
      `INSERT INTO identity.support_message(ticket_id,sender_user_id,message) VALUES($1,$2,$3) RETURNING id,message,created_at AS "createdAt"`,
      [id, userId, message.trim()],
    );
    await this.dataSource.query(
      `UPDATE identity.support_ticket SET updated_at=now() WHERE id=$1`,
      [id],
    );
    return row;
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
