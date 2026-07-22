import { of, lastValueFrom } from 'rxjs';
import { TransformInterceptor } from './transform.interceptor';

// TC1: javob {statusCode, message, data} qobig'iga o'raladi
describe('TransformInterceptor (TC1)', () => {
  const ctx = (statusCode = 200) =>
    ({ switchToHttp: () => ({ getResponse: () => ({ statusCode }) }) }) as any;
  const handler = (val: unknown) => ({ handle: () => of(val) }) as any;

  it("oddiy qiymatni qobiqqa o'raydi", async () => {
    const res = await lastValueFrom(
      new TransformInterceptor().intercept(ctx(200), handler({ id: '1' })),
    );
    expect(res).toEqual({ statusCode: 200, message: 'OK', data: { id: '1' } });
  });

  it('201 status va null data', async () => {
    const res = await lastValueFrom(
      new TransformInterceptor().intercept(ctx(201), handler(null)),
    );
    expect(res).toEqual({ statusCode: 201, message: 'OK', data: null });
  });

  it('handler {message,data} qaytarsa hurmat qilinadi', async () => {
    const res = await lastValueFrom(
      new TransformInterceptor().intercept(
        ctx(200),
        handler({ message: 'Yaratildi', data: { id: '9' } }),
      ),
    );
    expect(res).toEqual({
      statusCode: 200,
      message: 'Yaratildi',
      data: { id: '9' },
    });
  });
});
