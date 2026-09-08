import { CheckoutService } from './checkout.service';

describe('Checkout payment ownership/amount', () => {
  const query = jest.fn();
  const service = new CheckoutService(
    { query } as never,
    {} as never,
    {} as never,
  );
  beforeEach(() => query.mockReset());
  it('uses customer scope and returns database amount', async () => {
    query.mockResolvedValue([
      {
        total_amount: '125000.00',
        payment_method: 'online',
        status: 'PENDING_PAYMENT',
      },
    ]);
    await expect(service.paymentContext('42', '7')).resolves.toEqual({
      amount: 125000,
    });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('id=$1 AND customer_id=$2'),
      ['42', '7'],
    );
  });
  it('another buyer or missing order is rejected', async () => {
    query.mockResolvedValue([]);
    await expect(service.paymentContext('42', '8')).rejects.toMatchObject({
      status: 404,
    });
  });
  it.each([
    { payment_method: 'cod', status: 'DRAFT' },
    { payment_method: 'online', status: 'CONFIRMED' },
    { payment_method: 'online', status: 'CANCELLED' },
  ])('non-payable order is rejected: %j', async (order) => {
    query.mockResolvedValue([order]);
    await expect(service.paymentContext('42', '7')).rejects.toMatchObject({
      status: 400,
    });
  });
  it('bigint overflow rejected before SQL', async () => {
    await expect(
      service.paymentContext('9223372036854775808', '7'),
    ).rejects.toMatchObject({ status: 404 });
    expect(query).not.toHaveBeenCalled();
  });
});
