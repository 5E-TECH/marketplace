import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ClientsModule } from '@nestjs/microservices';
import {
  CommonAuthModule,
  CommonConfigModule,
  JwtAuthGuard,
  RmqClient,
  RmqQueue,
  RolesGuard,
  rmqOptions,
} from '@app/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { EchoController } from './echo.controller';

@Module({
  imports: [
    CommonConfigModule, // .env + Joi (global)
    CommonAuthModule, // JWT + guardlar (global)
    // Servislarga RMQ client'lari (hozircha echo; keyin identity/catalog/...)
    ClientsModule.registerAsync([
      {
        name: RmqClient.ECHO,
        inject: [ConfigService],
        useFactory: (config: ConfigService) =>
          rmqOptions([config.get<string>('RABBITMQ_URL')!], RmqQueue.ECHO),
      },
    ]),
  ],
  controllers: [AppController, EchoController],
  providers: [
    AppService,
    // Global auth: avval JWT (401), keyin rol (403)
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
