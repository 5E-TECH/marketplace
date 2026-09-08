import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { AdminAuditQueryDto } from './admin-audit.dto';

describe('AdminAuditQueryDto (C6.3)', () => {
  const pipe = new ValidationPipe({ transform: true, whitelist: true });
  const transform = (query: object) =>
    pipe.transform(query, {
      type: 'query',
      metatype: AdminAuditQueryDto,
    });

  it('HTTP query sonlarga aylanadi, actorId esa string qoladi', async () => {
    await expect(
      transform({ page: '2', limit: '10', actorId: '9007199254740993' }),
    ).resolves.toEqual({ page: 2, limit: 10, actorId: '9007199254740993' });
  });

  it.each([
    { actorId: 'abc' },
    { actorId: '-1' },
    { actorId: '' },
    { page: '0' },
    { page: '1.5' },
    { limit: '101' },
    { limit: 'abc' },
    { dateFrom: '2026-02-30' },
    { dateTo: 'yesterday' },
    { action: 'a'.repeat(101) },
  ])('noto‘g‘ri HTTP query uchun 400: %j', async (query) => {
    await expect(transform(query)).rejects.toThrow(BadRequestException);
  });
});
