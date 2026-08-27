import { AddGuestFavorites1724500800000 } from './1724500800000-add-guest-favorites';

describe('AddGuestFavorites migration', () => {
  it('guest owner va alohida unique indexlarni yaratadi', async () => {
    const queries: string[] = [];
    const runner = { query: jest.fn(async (sql: string) => queries.push(sql)) };

    await new AddGuestFavorites1724500800000().up(runner as never);

    const sql = queries.join('\n');
    expect(sql).toContain('session_id VARCHAR(128)');
    expect(sql).toContain('uq_catalog_favorite_session_product');
    expect(sql).toContain('chk_catalog_favorite_owner');
    expect(sql).toContain('ALTER COLUMN user_id DROP NOT NULL');
  });
});
