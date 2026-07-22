import { Module } from '@nestjs/common';
import { CommonConfigModule } from '@app/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
  imports: [
    CommonConfigModule, // .env + Joi validatsiya (global)
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
