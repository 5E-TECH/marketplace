import { RequestContext } from '../context/request-context';
import { RequestIdMiddleware } from './request-id.middleware';

describe('RequestIdMiddleware', () => {
  const run = (headers: Record<string, string | string[] | undefined>) => {
    const req: { headers: typeof headers; requestId?: string } = { headers };
    const setHeader = jest.fn();
    let seenInContext: string | undefined;

    new RequestIdMiddleware().use(req, { setHeader }, () => {
      seenInContext = RequestContext.requestId();
    });

    return { req, setHeader, seenInContext };
  };

  it('kelgan xavfsiz X-Request-Id ni saqlaydi', () => {
    const { req, setHeader, seenInContext } = run({
      'x-request-id': 'trace-abc.123',
    });

    expect(req.requestId).toBe('trace-abc.123');
    expect(setHeader).toHaveBeenCalledWith('X-Request-Id', 'trace-abc.123');
    expect(seenInContext).toBe('trace-abc.123');
  });

  it('sarlavha yo‘q bo‘lsa yangi ID generatsiya qiladi', () => {
    const { req, seenInContext } = run({});

    expect(req.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(seenInContext).toBe(req.requestId);
  });

  it('xavfsiz bo‘lmagan ID rad etiladi (log/sarlavha injection)', () => {
    for (const unsafe of ['bad id', 'a\nb', '<script>', 'x'.repeat(200)]) {
      const { req } = run({ 'x-request-id': unsafe });
      expect(req.requestId).not.toBe(unsafe);
      expect(req.requestId).toMatch(/^[0-9a-f-]{36}$/);
    }
  });

  it('massiv sarlavhadan birinchi qiymatni oladi', () => {
    const { req } = run({ 'x-request-id': ['first-id', 'second-id'] });
    expect(req.requestId).toBe('first-id');
  });

  it('kontekst tashqarisida requestId undefined', () => {
    expect(RequestContext.requestId()).toBeUndefined();
  });
});
