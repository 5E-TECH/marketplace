import { Controller, UseFilters } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { LoginDto, RegisterDto, RpcHttpExceptionFilter } from '@app/common';
import { AuthService } from './auth.service';

/**
 * RMQ orqali gateway'dan keladigan auth so'rovlarini boshqaradi.
 */
@Controller()
@UseFilters(RpcHttpExceptionFilter)
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @MessagePattern({ cmd: 'auth.register' })
  register(@Payload() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @MessagePattern({ cmd: 'auth.login' })
  login(@Payload() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @MessagePattern({ cmd: 'auth.logout' })
  logout(@Payload() data: { userId: string }) {
    return this.authService.logout(data.userId);
  }

  @MessagePattern({ cmd: 'auth.me' })
  me(@Payload() data: { userId: string }) {
    return this.authService.getById(data.userId);
  }
}
