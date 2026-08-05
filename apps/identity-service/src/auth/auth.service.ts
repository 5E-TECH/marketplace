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
    const payload = { sub: user.id, role: user.role };
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
