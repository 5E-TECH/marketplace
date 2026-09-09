import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { Role } from '../enums';
import {
  CreateAdminTeamMemberDto,
  UpdateAdminTeamRoleDto,
} from './admin-team.dto';

describe('Admin team DTO (C6.1)', () => {
  const pipe = new ValidationPipe({ transform: true, whitelist: true });

  it('ADMIN va SUPERADMIN qiymatlarini qabul qiladi', async () => {
    await expect(
      pipe.transform(
        {
          name: 'Admin',
          phone: '+998901112233',
          role: Role.ADMIN,
          password: 'Secret123',
        },
        { type: 'body', metatype: CreateAdminTeamMemberDto },
      ),
    ).resolves.toBeInstanceOf(CreateAdminTeamMemberDto);
    await expect(
      pipe.transform(
        { role: Role.SUPERADMIN },
        { type: 'body', metatype: UpdateAdminTeamRoleDto },
      ),
    ).resolves.toBeInstanceOf(UpdateAdminTeamRoleDto);
  });

  it.each([
    { name: '', phone: '+998901112233', role: Role.ADMIN },
    { name: 'Admin', phone: '901112233', role: Role.ADMIN },
    { name: 'Admin', phone: '+998901112233', role: Role.SELLER },
    {
      name: 'Admin',
      phone: '+998901112233',
      role: Role.ADMIN,
      password: 'short',
    },
  ])('noto‘g‘ri create body rad etiladi: %j', async (body) => {
    await expect(
      pipe.transform(body, {
        type: 'body',
        metatype: CreateAdminTeamMemberDto,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
