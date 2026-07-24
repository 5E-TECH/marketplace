import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { createHash, randomUUID } from 'crypto';
import {
  BusinessException,
  LoginDto,
  LogoutDto,
  RegisterDto,
  Role,
} from '@app/common';
import { User } from '../entities/user.entity';
import { AuthSession } from '../entities/auth-session.entity';

const BCRYPT_ROUNDS = 10;

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(AuthSession)
    private readonly sessions: Repository<AuthSession>,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
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

  async logout(userId: string, dto: LogoutDto): Promise<null> {
    let payload: { sub: string; jti: string };
    try {
      payload = await this.jwt.verifyAsync(dto.refreshToken, {
        secret: this.config.get<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Refresh token yaroqsiz');
    }
    if (payload.sub !== userId || !payload.jti) {
      throw new UnauthorizedException('Refresh token yaroqsiz');
    }

    const session = await this.sessions.findOne({
      where: { id: payload.jti, userId },
    });
    if (!session || session.tokenHash !== this.hashToken(dto.refreshToken)) {
      throw new UnauthorizedException('Refresh token yaroqsiz');
    }
    if (!session.revokedAt) {
      session.revokedAt = new Date();
      await this.sessions.save(session);
    }
    return null;
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
