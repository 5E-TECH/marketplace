import { swaggerEnabled } from './swagger-enabled';

describe('BE-26 TC1: prod’da Swagger yopiq', () => {
  const config = (env: Record<string, string>) => ({
    get: (key: string) => env[key],
  });

  it('prod — sukut bo‘yicha o‘chiq; boshqa muhit — yoqiq', () => {
    expect(swaggerEnabled(config({ NODE_ENV: 'production' }))).toBe(false);
    expect(swaggerEnabled(config({ NODE_ENV: 'development' }))).toBe(true);
    expect(swaggerEnabled(config({}))).toBe(true);
  });

  it('SWAGGER_ENABLED aniq berilsa — u ustun', () => {
    expect(
      swaggerEnabled(config({ NODE_ENV: 'production', SWAGGER_ENABLED: 'on' })),
    ).toBe(true);
    expect(
      swaggerEnabled(
        config({ NODE_ENV: 'development', SWAGGER_ENABLED: 'off' }),
      ),
    ).toBe(false);
  });
});
