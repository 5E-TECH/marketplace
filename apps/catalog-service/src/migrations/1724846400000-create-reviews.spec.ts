import { CreateReviews1724846400000 } from './1724846400000-create-reviews';

describe('CreateReviews1724846400000', () => {
  it('review va product rating sxemasini yaratadi', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    await new CreateReviews1724846400000().up({ query } as never);
    const sql = query.mock.calls.map(([value]) => value).join('\n');
    expect(sql).toContain('catalog.review');
    expect(sql).toContain('order_item_id');
    expect(sql).toContain('UNIQUE(order_item_id)');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS rating');
  });
});
