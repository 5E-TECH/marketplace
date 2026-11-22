import { ConfigService } from '@nestjs/config';

/** BE-26 (T8: «prod’da Swagger yopiq»): `SWAGGER_ENABLED=on|off`; berilmasa — prod’da o‘chiq, boshqa muhitda yoqiq. */
export function swaggerEnabled(config: Pick<ConfigService, 'get'>): boolean {
  const flag = String(config.get<string>('SWAGGER_ENABLED') ?? '')
    .trim()
    .toLowerCase();
  if (flag === 'on' || flag === 'true') return true;
  if (flag === 'off' || flag === 'false') return false;
  return config.get<string>('NODE_ENV') !== 'production';
}
