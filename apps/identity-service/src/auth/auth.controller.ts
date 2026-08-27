import { Controller, UseFilters } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  LoginDto,
  CreateSupportTicketDto,
  ForgotPasswordDto,
  RegisterDto,
  ResetPasswordDto,
  RpcHttpExceptionFilter,
  SellerRegisterDto,
  UpdateProfileDto,
  VerifyPhoneDto,
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
  @MessagePattern({ cmd: 'auth.refresh' }) refresh(
    @Payload() d: { refreshToken: string },
  ) {
    return this.authService.refresh(d.refreshToken);
  }
  @MessagePattern({ cmd: 'auth.forgot-password' }) forgot(
    @Payload() d: ForgotPasswordDto,
  ) {
    return this.authService.createVerificationCode(d);
  }
  @MessagePattern({ cmd: 'auth.reset-password' }) reset(
    @Payload() d: ResetPasswordDto,
  ) {
    return this.authService.resetPassword(d);
  }
  @MessagePattern({ cmd: 'auth.verify-phone' }) verify(
    @Payload() d: VerifyPhoneDto,
  ) {
    return this.authService.verifyPhone(d);
  }
  @MessagePattern({ cmd: 'auth.resend-code' }) resend(
    @Payload() d: ForgotPasswordDto,
  ) {
    return this.authService.createVerificationCode(d, 'PHONE_VERIFY');
  }
  @MessagePattern({ cmd: 'auth.sessions.list' }) sessions(
    @Payload() d: { userId: string },
  ) {
    return this.authService.listSessions(d.userId);
  }
  @MessagePattern({ cmd: 'auth.sessions.revoke' }) revoke(
    @Payload() d: { userId: string; sessionId: string },
  ) {
    return this.authService.revokeSession(d.userId, d.sessionId);
  }
  @MessagePattern({ cmd: 'support.ticket.create' }) createTicket(
    @Payload() d: { userId: string; dto: CreateSupportTicketDto },
  ) {
    return this.authService.createTicket(d.userId, d.dto);
  }
  @MessagePattern({ cmd: 'support.ticket.list' }) listTickets(
    @Payload() d: { userId: string; query: any },
  ) {
    return this.authService.listTickets(d.userId, d.query);
  }
  @MessagePattern({ cmd: 'support.ticket.get' }) getTicket(
    @Payload() d: { userId: string; id: string },
  ) {
    return this.authService.getTicket(d.userId, d.id);
  }
  @MessagePattern({ cmd: 'support.ticket.message' }) addMessage(
    @Payload() d: { userId: string; id: string; message: string },
  ) {
    return this.authService.addTicketMessage(d.userId, d.id, d.message);
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

  @MessagePattern({ cmd: 'identity.user.admin-list' })
  adminListUsers(
    @Payload()
    data: {
      query?: {
        role?: string;
        blocked?: boolean;
        search?: string;
        page?: number;
        limit?: number;
      };
    },
  ) {
    return this.authService.adminListUsers(data?.query ?? {});
  }

  @MessagePattern({ cmd: 'identity.user.admin-get' })
  adminGetUser(@Payload() data: { userId: string }) {
    return this.authService.adminGetUser(String(data.userId));
  }

  @MessagePattern({ cmd: 'auth.profile.update' })
  updateProfile(@Payload() data: { userId: string; dto: UpdateProfileDto }) {
    return this.authService.updateProfile(String(data.userId), data.dto);
  }

  @MessagePattern({ cmd: 'identity.user.set-blocked' })
  setBlocked(
    @Payload() data: { actorId: string; userId: string; blocked: boolean },
  ) {
    return this.authService.setBlocked(
      String(data.actorId),
      String(data.userId),
      Boolean(data.blocked),
    );
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

  @MessagePattern({ cmd: 'identity.operator.update' })
  updateOperator(
    @Payload()
    data: {
      shopId: string;
      operatorId: string;
      dto: {
        name?: string;
        phone?: string;
        password?: string;
        isActive?: boolean;
      };
    },
  ) {
    return this.authService.updateOperator(
      String(data.shopId),
      String(data.operatorId),
      data.dto,
    );
  }

  @MessagePattern({ cmd: 'identity.operator.remove' })
  removeOperator(@Payload() data: { shopId: string; operatorId: string }) {
    return this.authService.removeOperator(
      String(data.shopId),
      String(data.operatorId),
    );
  }
}
