import { CreateTemplatesAndBroadcasts1727136000000 } from './1727136000000-create-templates-and-broadcasts';

describe('CreateTemplatesAndBroadcasts1727136000000', () => {
  it('shablon va ommaviy xabar jadvallarini yaratadi, token noyob', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    await new CreateTemplatesAndBroadcasts1727136000000().up({
      query,
    } as never);
    const sql = query.mock.calls
      .map(([statement]) => String(statement))
      .join('\n');
    expect(sql).toContain('"notification"."notification_template"');
    expect(sql).toContain('"notification"."broadcast"');
    expect(sql).toContain('UNIQUE ("preview_token")');
  });

  it('down ikkala jadvalni olib tashlaydi', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    await new CreateTemplatesAndBroadcasts1727136000000().down({
      query,
    } as never);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining(
        'DROP TABLE IF EXISTS "notification"."broadcast"',
      ),
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining(
        'DROP TABLE IF EXISTS "notification"."notification_template"',
      ),
    );
  });
});
