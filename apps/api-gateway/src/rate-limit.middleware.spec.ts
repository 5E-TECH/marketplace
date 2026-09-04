import { RateLimitMiddleware } from './rate-limit.middleware';

describe('RateLimitMiddleware (C4.7)', () => {
  it('TC4: production limitdan oshganda 429 qaytaradi', () => {
    const middleware = new RateLimitMiddleware({
      get: (_key: string, fallback: number) =>
        _key === 'RATE_LIMIT_MAX' ? 2 : fallback,
    } as never);
    const req = { path: '/api/v1/auth/login', ip: '1.2.3.4', socket: {} };
    const json = jest.fn();
    const status = jest.fn(() => ({ json }));
    const res = { setHeader: jest.fn(), status };
    const next = jest.fn();

    middleware.use(req as never, res as never, next);
    middleware.use(req as never, res as never, next);
    middleware.use(req as never, res as never, next);

    expect(next).toHaveBeenCalledTimes(2);
    expect(status).toHaveBeenCalledWith(429);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: 'RATE_LIMITED' }),
    );
  });
});
