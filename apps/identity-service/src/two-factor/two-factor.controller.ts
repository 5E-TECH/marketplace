import { Controller, UseFilters } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { RpcHttpExceptionFilter } from '@app/common';
import { TwoFactorService } from './two-factor.service';

/** BE-26: xodim 2FA (TOTP) — gateway `auth/2fa/*`, `admin/users/:id/2fa/reset`. */
@Controller()
@UseFilters(RpcHttpExceptionFilter)
export class TwoFactorController {
  constructor(private readonly svc: TwoFactorService) {}

  @MessagePattern({ cmd: 'auth.2fa.setup' })
  setup(@Payload() data: { challengeToken: string }) {
    return this.svc.setup(String(data?.challengeToken ?? ''));
  }

  @MessagePattern({ cmd: 'auth.2fa.enable' })
  enable(@Payload() data: { challengeToken: string; code: string }) {
    return this.svc.enable(
      String(data?.challengeToken ?? ''),
      String(data?.code ?? ''),
    );
  }

  @MessagePattern({ cmd: 'auth.2fa.verify' })
  verify(
    @Payload()
    data: {
      challengeToken: string;
      code?: string;
      recoveryCode?: string;
    },
  ) {
    return this.svc.verify(
      String(data?.challengeToken ?? ''),
      data?.code,
      data?.recoveryCode,
    );
  }

  @MessagePattern({ cmd: 'identity.2fa.reset' })
  reset(@Payload() data: { actorId: string; userId: string }) {
    return this.svc.reset(
      String(data?.actorId ?? ''),
      String(data?.userId ?? ''),
    );
  }
}
