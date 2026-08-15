import { Controller, UseFilters } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  LoginDto,
  RegisterDto,
  RpcHttpExceptionFilter,
  SellerRegisterDto,
} from '@app/common';
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

  @MessagePattern({ cmd: 'seller.register' })
  registerSeller(@Payload() dto: SellerRegisterDto) {
    return this.authService.registerSeller(dto);
  }

  @MessagePattern({ cmd: 'identity.user.set-active' })
  setActive(@Payload() data: { userId: string; isActive: boolean }) {
    return this.authService.setActive(
      String(data.userId),
      Boolean(data.isActive),
    );
  }

  @MessagePattern({ cmd: 'identity.user.count-by-role' })
  countUsersByRole() {
    return this.authService.countUsersByRole();
  }

  // --- Market operatorlari (C1.38) ---
  @MessagePattern({ cmd: 'identity.operator.create' })
  createOperator(
    @Payload()
    data: {
      shopId: string;
      dto: { name: string; phone: string; password: string };
    },
  ) {
    return this.authService.createOperator(String(data.shopId), data.dto);
  }

  @MessagePattern({ cmd: 'identity.operator.list' })
  listOperators(@Payload() data: { shopId: string }) {
    return this.authService.listOperators(String(data.shopId));
  }

  @MessagePattern({ cmd: 'identity.operator.remove' })
  removeOperator(@Payload() data: { shopId: string; operatorId: string }) {
    return this.authService.removeOperator(
      String(data.shopId),
      String(data.operatorId),
    );
  }
}
