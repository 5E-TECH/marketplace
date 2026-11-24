import { of, throwError } from 'rxjs';
import { OpsHealthController } from './ops-health.controller';

describe('BE-26: GET /health/ops (monitor)', () => {
  const token = 'monitor-token-0123456789';
  const make = (
    env: Record<string, string>,
    integration = { send: jest.fn(() => of({ count: 12 })) },
    lead = {
      send: jest.fn((pattern: { cmd: string }) =>
        pattern.cmd === 'lead.ops.rate-limit'
          ? of({ redisConfigured: true, store: 'redis' })
          : of({ waiting: 4, oldestMinutes: 11 }),
      ),
    },
    rateLimit = { redisConfigured: false, store: 'memory' },
  ) =>
    new OpsHealthController(
      { get: (k: string) => env[k] } as never,
      integration as never,
      lead as never,
      { health: () => rateLimit } as never,
    );

  it('token yo‘q, noto‘g‘ri yoki sozlanmagan (yoki qisqa) — 404', async () => {
    await expect(
      make({ MONITOR_TOKEN: token }).ops(undefined),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      make({ MONITOR_TOKEN: token }).ops('boshqa'),
    ).rejects.toMatchObject({ status: 404 });
    await expect(make({}).ops(token)).rejects.toMatchObject({ status: 404 });
    await expect(
      make({ MONITOR_TOKEN: 'qisqa' }).ops('qisqa'),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('Elchi xatolari (5 daqiqa) va lid navbati; servis javob bermasa — null', async () => {
    const integration = { send: jest.fn(() => of({ count: 12 })) };
    await expect(
      make({ MONITOR_TOKEN: token }, integration).ops(token),
    ).resolves.toEqual({
      elchiApiErrors5m: 12,
      leadQueue: { waiting: 4, oldestMinutes: 11 },
      rateLimit: { redisConfigured: false, store: 'memory' },
      leadRateLimit: { redisConfigured: true, store: 'redis' },
    });
    expect(integration.send).toHaveBeenCalledWith(
      { cmd: 'integration.ops.errors' },
      { minutes: 5 },
    );
    await expect(
      make(
        { MONITOR_TOKEN: token },
        { send: jest.fn(() => throwError(() => new Error('rmq'))) },
      ).ops(token),
    ).resolves.toMatchObject({ elchiApiErrors5m: null });
    await expect(
      make({ MONITOR_TOKEN: token }, undefined, {
        send: jest.fn((_pattern: { cmd: string }) =>
          throwError(() => new Error('rmq')),
        ),
      }).ops(token),
    ).resolves.toMatchObject({ leadQueue: null, leadRateLimit: null });
  });

  it('BE-36: so‘rov chegarasi holati — Redis berilgan, lekin uzilgan', async () => {
    await expect(
      make({ MONITOR_TOKEN: token }, undefined, undefined, {
        redisConfigured: true,
        store: 'memory',
      }).ops(token),
    ).resolves.toMatchObject({
      rateLimit: { redisConfigured: true, store: 'memory' },
    });
  });
});
