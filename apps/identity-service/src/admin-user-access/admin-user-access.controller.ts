import { Controller, UseFilters } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { Role, RpcHttpExceptionFilter, UpdateUserRoleDto } from '@app/common';
import { AdminUserAccessService } from './admin-user-access.service';

@Controller()
@UseFilters(RpcHttpExceptionFilter)
export class AdminUserAccessController {
  constructor(private readonly access: AdminUserAccessService) {}

  @MessagePattern({ cmd: 'identity.user.role.update' })
  updateRole(
    @Payload()
    data: {
      actorId: string;
      userId: string;
      dto: UpdateUserRoleDto;
      ip?: string;
    },
  ) {
    return this.access.updateRole(
      String(data.actorId),
      String(data.userId),
      data.dto,
      data.ip,
    );
  }

  @MessagePattern({ cmd: 'identity.user.impersonate' })
  impersonate(
    @Payload()
    data: {
      actorId: string;
      userId: string;
      ip?: string;
    },
  ) {
    return this.access.impersonate(
      String(data.actorId),
      String(data.userId),
      data.ip,
    );
  }

  @MessagePattern({ cmd: 'identity.user.authorize-token' })
  authorizeToken(
    @Payload()
    data: {
      userId: string;
      role: Role;
      authVersion?: number;
    },
  ) {
    return this.access.authorizeToken(
      String(data.userId),
      data.role,
      data.authVersion,
    );
  }
}
