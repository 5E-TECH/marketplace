import { HttpStatus } from '@nestjs/common';
import { AppController } from './app.controller';
import type { AppService, ReadinessResult } from './app.service';

describe('AppController — health', () => {
  const makeResponse = () => {
    const status = jest.fn();
    return { response: { status } as never, status };
  };

  const readiness = (state: 'ok' | 'degraded'): ReadinessResult => ({
    status: state,
    service: 'api-gateway',
    uptime: 1,
    timestamp: '2026-01-01T00:00:00.000Z',
    checks: {
      database: { status: state === 'ok' ? 'ok' : 'down', latencyMs: 1 },
      rabbitmq: { status: 'ok', latencyMs: 1 },
    },
  });

  it('/health — tiriklik, bog‘liqliklarni tekshirmaydi', () => {
    const service = {
      health: () => ({ status: 'ok' }),
    } as unknown as AppService;
    expect(new AppController(service).health()).toEqual({ status: 'ok' });
  });

  it('/health/ready — hammasi tirik bo‘lsa statusni o‘zgartirmaydi', async () => {
    const service = {
      readiness: jest.fn().mockResolvedValue(readiness('ok')),
    } as unknown as AppService;
    const { response, status } = makeResponse();

    const result = await new AppController(service).ready(response);

    expect(status).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({ status: 'ok' }));
  });

  it('/health/ready — bog‘liqlik yiqilsa 503 qaytaradi', async () => {
    const service = {
      readiness: jest.fn().mockResolvedValue(readiness('degraded')),
    } as unknown as AppService;
    const { response, status } = makeResponse();

    const result = await new AppController(service).ready(response);

    expect(status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
    expect(result).toEqual(expect.objectContaining({ status: 'degraded' }));
  });
});
