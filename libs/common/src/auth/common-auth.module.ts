import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { RolesGuard } from '../guards/roles.guard';
import { SelfGuard } from '../guards/self.guard';

/**
 * JWT'ni config'dan sozlaydi va guard'larni global qilib eksport qiladi.
 * Servis app.module'da import qiladi: `CommonAuthModule`.
 */
@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET'),
        // signOptions (expiresIn) — token IMZOLAGAN servisda (identity) beriladi;
        // bu yerda faqat verify uchun secret kerak.
      }),
    }),
  ],
  providers: [JwtAuthGuard, RolesGuard, SelfGuard],
  exports: [JwtModule, JwtAuthGuard, RolesGuard, SelfGuard],
})
export class CommonAuthModule {}
