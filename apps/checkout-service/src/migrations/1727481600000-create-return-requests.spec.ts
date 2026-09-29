import { CreateReturnRequests1727481600000 } from './1727481600000-create-return-requests';

describe('CreateReturnRequests1727481600000', () => {
  it('so‘rov, tovar qatorlari va tarix jadvallarini yaratadi', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    await new CreateReturnRequests1727481600000().up({ query } as never);
    const sql = query.mock.calls.map(([value]) => value).join('\n');
    expect(sql).toContain('checkout.return_request (');
    expect(sql).toContain('checkout.return_request_item (');
    expect(sql).toContain('checkout.return_request_history (');
    expect(sql).toContain('CHECK (quantity > 0)');
  });

  it('down jadvallarni FK tartibida o‘chiradi', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    await new CreateReturnRequests1727481600000().down({ query } as never);
    expect(query.mock.calls.map(([value]) => value)).toEqual([
      'DROP TABLE IF EXISTS checkout.return_request_history',
      'DROP TABLE IF EXISTS checkout.return_request_item',
      'DROP TABLE IF EXISTS checkout.return_request',
    ]);
  });
});
