import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ClientProxy } from '@nestjs/microservices';
import { JwtUser, Role, ROLES_KEY, RmqClient, sendRpc } from '@app/common';

/**
 * C6.5 — @Roles route'larida JWT ichidagi rol/versiyani joriy DB holati bilan
 * tekshiradi. Rol yoki authVersion o'zgargan eski access token darhol 401 oladi.
 */
@Injectable()
export class CurrentRoleGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(RmqClient.IDENTITY) private readonly identity: ClientProxy,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user as JwtUser;
    await sendRpc(
      this.identity,
      { cmd: 'identity.user.authorize-token' },
      {
        userId: user.sub,
        role: user.role,
        authVersion: user.authVersion,
      },
    );
    return true;
  }
}
