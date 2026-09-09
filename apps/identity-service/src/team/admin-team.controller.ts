import { Controller, UseFilters } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  CreateAdminTeamMemberDto,
  RpcHttpExceptionFilter,
  UpdateAdminTeamRoleDto,
} from '@app/common';
import { AdminTeamService } from './admin-team.service';

@Controller()
@UseFilters(RpcHttpExceptionFilter)
export class AdminTeamController {
  constructor(private readonly team: AdminTeamService) {}

  @MessagePattern({ cmd: 'identity.admin-team.list' })
  list(@Payload() data: { actorId: string }) {
    return this.team.list(String(data.actorId));
  }

  @MessagePattern({ cmd: 'identity.admin-team.create' })
  create(
    @Payload()
    data: {
      actorId: string;
      dto: CreateAdminTeamMemberDto;
      ip?: string;
    },
  ) {
    return this.team.create(String(data.actorId), data.dto, data.ip);
  }

  @MessagePattern({ cmd: 'identity.admin-team.role.update' })
  updateRole(
    @Payload()
    data: {
      actorId: string;
      memberId: string;
      dto: UpdateAdminTeamRoleDto;
      ip?: string;
    },
  ) {
    return this.team.updateRole(
      String(data.actorId),
      String(data.memberId),
      data.dto,
      data.ip,
    );
  }

  @MessagePattern({ cmd: 'identity.admin-team.delete' })
  remove(
    @Payload()
    data: {
      actorId: string;
      memberId: string;
      ip?: string;
    },
  ) {
    return this.team.remove(
      String(data.actorId),
      String(data.memberId),
      data.ip,
    );
  }
}
