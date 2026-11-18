import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { of } from 'rxjs';
import { Role, ROLES_KEY, VariantReportQueryDto } from '@app/common';
import { AdminVariantReportController } from './admin-variant-report.controller';

describe('BE-39: S1 va S3 sinovi hisoboti (gateway)', () => {
  it('TC4: faqat ADMIN va SUPERADMIN — sotuvchi va operator → 403 (RolesGuard)', () => {
    expect(
      Reflect.getMetadata(ROLES_KEY, AdminVariantReportController),
    ).toEqual([Role.ADMIN, Role.SUPERADMIN]);
  });

  it('JSON va CSV lead-service ga; CSV fayl sifatida qaytadi', async () => {
    const send = jest.fn((pattern: { cmd: string }) =>
      of(
        pattern.cmd === 'lead.report.variant-csv'
          ? {
              fileName: 's1-s3-sinov_2027-01-01_2027-01-31.csv',
              content: '﻿Variant\r\n',
            }
          : { rows: [] },
      ),
    );
    const ctrl = new AdminVariantReportController({ send } as never);
    const query = { from: '2027-01-01', to: '2027-01-31' };
    await ctrl.report(query);
    expect(send).toHaveBeenLastCalledWith(
      { cmd: 'lead.report.variant' },
      { query },
    );
    const headers: Record<string, string> = {};
    const file = await ctrl.csv(query, {
      set: (h: Record<string, string>) => Object.assign(headers, h),
    } as never);
    expect(send).toHaveBeenLastCalledWith(
      { cmd: 'lead.report.variant-csv' },
      { query },
    );
    expect(headers).toEqual({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition':
        'attachment; filename="s1-s3-sinov_2027-01-01_2027-01-31.csv"',
    });
    expect(file.getStream().read().toString('utf8')).toBe('﻿Variant\r\n');
  });

  it('davr majburiy; mahsulot ID si faqat musbat son', async () => {
    const errors = async (body: Record<string, unknown>) =>
      (
        await validate(plainToInstance(VariantReportQueryDto, body), {
          whitelist: true,
          forbidNonWhitelisted: true,
        })
      ).map((e) => e.property);
    expect(await errors({})).toEqual(['from', 'to']);
    expect(
      await errors({ from: '2027-01-01', to: '2027-01-31', productId: 'x' }),
    ).toEqual(['productId']);
    expect(
      await errors({ from: '2027-01-01', to: '2027-01-31', variant: 's1' }),
    ).toEqual(['variant']);
  });
});
