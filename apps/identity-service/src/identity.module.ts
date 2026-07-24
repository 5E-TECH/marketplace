import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  CommonAuthModule,
  CommonConfigModule,
  ensureSchema,
  typeOrmOptions,
} from '@app/common';
import { User } from './entities/user.entity';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { AdminSeeder } from './seed/admin.seeder';
import { AuthSession } from './entities/auth-session.entity';
import { CreateAuthSession1721908800000 } from './migrations/1721908800000-create-auth-session';

const entities = [User, AuthSession];

@Module({
  imports: [
    CommonConfigModule, // .env + Joi
    CommonAuthModule, // JwtService (JWT_SECRET)
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: async (config: ConfigService) => {
        await ensureSchema(config, 'identity'); // schema mavjud bo'lsin
        return {
          ...typeOrmOptions(config, 'identity', entities),
          migrations: [CreateAuthSession1721908800000],
          migrationsRun: true,
        };
      },
    }),
    TypeOrmModule.forFeature(entities),
  ],
  controllers: [AuthController],
  providers: [AuthService, AdminSeeder],
})
export class IdentityModule {}
