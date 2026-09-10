import { CreatePlatformSettings1725897600000 } from './1725897600000-create-platform-settings';

describe('CreatePlatformSettings1725897600000', () => {
  it('singleton, qiymat cheklovlari va boshlang‘ich yozuvni yaratadi', async () => {
    const query = jest.fn(async () => undefined);
    await new CreatePlatformSettings1725897600000().up({ query } as never);
    const sql = query.mock.calls.flat().join('\n');

    expect(sql).toContain('"identity"."platform_settings"');
    expect(sql).toContain('"commission_percent" BETWEEN 0 AND 100');
    expect(sql).toContain('"minimum_order_amount" >= 0');
    expect(sql).toContain('"id" = 1');
    expect(sql).toContain('ON CONFLICT ("id") DO NOTHING');
  });
});
