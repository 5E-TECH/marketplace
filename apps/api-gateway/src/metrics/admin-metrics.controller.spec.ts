import { of } from 'rxjs';
import {
  PLATFORM_METRICS_RPC,
  PlatformMetricsGroupBy,
  Role,
  ROLES_KEY,
} from '@app/common';
import { AdminMetricsController } from './admin-metrics.controller';

describe('AdminMetricsController (BE-46, FE-22)', () => {
  const leads = { rows: [], totals: { key: 'TOTAL' } };
  const finance = { rows: [], totals: { key: 'TOTAL' } };

  function setup() {
    const lead = jest.fn(() => of(leads));
    const fin = jest.fn(() => of(finance));
    const controller = new AdminMetricsController(
      { send: lead } as never,
      { send: fin } as never,
    );
    return { controller, lead, fin };
  }

  it('TC5: faqat ADMIN va SUPERADMIN', () => {
    expect(Reflect.getMetadata(ROLES_KEY, AdminMetricsController)).toEqual([
      Role.ADMIN,
      Role.SUPERADMIN,
    ]);
  });

  it('kun kesimi (sukut): lid va moliya qismi birlashadi', async () => {
    const { controller, lead, fin } = setup();
    expect(
      await controller.metrics({ from: '2026-12-01', to: '2026-12-07' }),
    ).toEqual({
      from: '2026-12-01',
      to: '2026-12-07',
      groupBy: PlatformMetricsGroupBy.DAY,
      leads,
      finance,
    });
    expect(lead).toHaveBeenCalledWith(
      { cmd: PLATFORM_METRICS_RPC.LEADS },
      { from: '2026-12-01', to: '2026-12-07', groupBy: 'DAY' },
    );
    expect(fin).toHaveBeenCalledWith(
      { cmd: PLATFORM_METRICS_RPC.FINANCE },
      { from: '2026-12-01', to: '2026-12-07' },
    );
  });

  it('boshqa kesimda moliya qismi null va so‘ralmaydi', async () => {
    const { controller, fin } = setup();
    const r = await controller.metrics({
      from: '2026-12-01',
      to: '2026-12-07',
      groupBy: PlatformMetricsGroupBy.OPERATOR,
    });
    expect(r.finance).toBeNull();
    expect(fin).not.toHaveBeenCalled();
  });
});
