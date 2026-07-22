import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { Role } from '@app/common';
import { User } from '../entities/user.entity';

/**
 * Boshlang'ich SUPERADMIN seed — FAQAT SEED_ADMIN_PHONE + SEED_ADMIN_PASSWORD
 * env berilgan bo'lsa. Aks holda o'tkazib yuboriladi (hardcoded parol yo'q).
 */
@Injectable()
export class AdminSeeder implements OnApplicationBootstrap {
  private readonly logger = new Logger(AdminSeeder.name);

  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly config: ConfigService,
  ) {}

  async onApplicationBootstrap() {
    const phone = this.config.get<string>('SEED_ADMIN_PHONE');
    const password = this.config.get<string>('SEED_ADMIN_PASSWORD');
    if (!phone || !password) return;

    const exists = await this.users.findOne({ where: { phone } });
    if (exists) return;

    await this.users.save(
      this.users.create({
        name: 'Super Admin',
        phone,
        email: null,
        passwordHash: await bcrypt.hash(password, 10),
        role: Role.SUPERADMIN,
        isActive: true,
      }),
    );
    this.logger.log(`SUPERADMIN seed qilindi: ${phone}`);
  }
}
