import { CreatePayoutSchedule1727568000000 } from './1727568000000-create-payout-schedule';

describe('CreatePayoutSchedule1727568000000', () => {
  it('har do‘konga bitta jadval va faqat ruxsat etilgan chastotalar', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    await new CreatePayoutSchedule1727568000000().up({ query } as never);
    const sql = query.mock.calls.map(([value]) => value).join('\n');
    expect(sql).toContain('finance.payout_schedule');
    expect(sql).toContain('UNIQUE (shop_id)');
    expect(sql).toContain("('DAILY','WEEKLY','MONTHLY')");
  });
});
