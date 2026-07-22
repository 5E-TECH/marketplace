import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { envValidationSchema } from './env.validation';

/**
 * Global config modul — har servis import qiladi.
 * `.env` ni o'qiydi va Joi sxemasi bilan tekshiradi.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env'],
      validationSchema: envValidationSchema,
      validationOptions: { abortEarly: false },
    }),
  ],
})
export class CommonConfigModule {}
