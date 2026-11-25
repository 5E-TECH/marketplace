import {
  BadRequestException,
  ConflictException,
  GatewayTimeoutException,
  PayloadTooLargeException,
  StreamableFile,
} from '@nestjs/common';
import { lastValueFrom, of, throwError } from 'rxjs';
import { Role, ROLES_KEY, SelfEmployedReason } from '@app/common';
import { AdminSelfEmployedController } from '../withdrawals/admin-self-employed.controller';
import { AffiliateProfileController } from './affiliate-profile.controller';
import {
  AffiliateSelfEmployedController,
  FileTooLargeInterceptor,
} from './affiliate-self-employed.controller';

const PINFL = '30101195600018';
const user = { sub: '77', role: Role.AFFILIATE } as never;
const finance7 = { sub: '7', role: Role.FINANCE } as never;
const FILE = {
  objectKey: 'private/affiliate/77/0f0e8f3a-1b2c-4d5e-8f90-a1b2c3d4e5f6.pdf',
  fileName: 'Маълумот (1).pdf',
  contentType: 'application/pdf',
  size: 12,
};
const INFO = { status: 'PENDING', pinflLast4: '0018' };

/** RPC stub: buyruq → javob (yoki xato); chaqiruvlar tartibi `calls` da. */
function rpc(
  answers: Record<string, unknown>,
  calls: Array<[string, unknown]>,
) {
  return {
    send: jest.fn(({ cmd }: { cmd: string }, data: unknown) => {
      calls.push([cmd, data]);
      const a = answers[cmd];
      return a instanceof Error ? throwError(() => a) : of(a ?? { ok: true });
    }),
  } as never;
}

describe('BE-25 5-tur: sotuvchi JShShIR arizasi (gateway)', () => {
  const make = (answers: Record<string, unknown> = {}) => {
    const calls: Array<[string, unknown]> = [];
    const client = rpc(
      {
        'identity.affiliate.profile.get': {
          firstName: ' Sevara ',
          lastName: 'Yusupova',
        },
        'finance.self-employed.submit': INFO,
        'file.affiliate-document.commit': FILE,
        ...answers,
      },
      calls,
    );
    return {
      calls,
      c: new AffiliateSelfEmployedController(client, client, client),
    };
  };
  const flush = () => new Promise((r) => setImmediate(r));

  it('yuborish: ID tokendan, ism profildan; auditda to‘liq JShShIR yo‘q', async () => {
    const { calls, c } = make();
    expect(await c.submit({ pinfl: ` ${PINFL} ` }, user, '1.2.3.4')).toBe(INFO);
    await flush();
    expect(calls.map(([cmd]) => cmd)).toEqual([
      'identity.affiliate.profile.get',
      'finance.self-employed.submit',
      'identity.audit.log',
    ]);
    expect(calls[1][1]).toEqual({
      affiliateId: '77',
      pinfl: PINFL,
      fullName: 'Sevara Yusupova',
      document: null,
    });
    expect(JSON.stringify(calls[2][1])).not.toContain(PINFL);
  });

  it('JShShIR 14 raqam emas — PINFL_INVALID, hech qanday chaqiruv yo‘q', async () => {
    const { calls, c } = make();
    for (const pinfl of ['', '123', `${PINFL}1`, 'abcdefghijklmn'])
      await expect(c.submit({ pinfl }, user, '')).rejects.toMatchObject({
        response: { errorCode: 'PINFL_INVALID' },
      });
    expect(calls).toEqual([]);
  });

  it('ariza aniq rad etilsa ko‘chirilgan fayl o‘chiriladi; natija noma’lum bo‘lsa — tegilmaydi', async () => {
    const dto = { pinfl: PINFL, documentId: 'd.pdf' };
    const rejected = make({
      'finance.self-employed.submit': new ConflictException({
        message: 'x',
        errorCode: 'ALREADY_PENDING',
      }),
    });
    await expect(rejected.c.submit(dto, user, '')).rejects.toMatchObject({
      status: 409,
    });
    await flush();
    expect(rejected.calls.map(([cmd]) => cmd)).toContain(
      'file.affiliate-document.remove',
    );
    const unknown = make({
      'finance.self-employed.submit': new GatewayTimeoutException(),
    });
    await expect(unknown.c.submit(dto, user, '')).rejects.toMatchObject({
      status: 504,
    });
    await flush();
    expect(unknown.calls.map(([cmd]) => cmd)).not.toContain(
      'file.affiliate-document.remove',
    );
  });

  it('yuklash: fayl yo‘q — FILE_REQUIRED; nom latin1 dan tiklanadi', async () => {
    const { calls, c } = make();
    expect(() => c.uploadDocument(undefined, user)).toThrow(
      BadRequestException,
    );
    await c.uploadDocument(
      {
        size: 3,
        mimetype: 'application/pdf',
        originalname: Buffer.from('Маълумот ʻ.pdf', 'utf8').toString('latin1'),
        buffer: Buffer.from('abc'),
      } as never,
      user,
    );
    expect(calls[0]).toEqual([
      'file.affiliate-document.store',
      {
        affiliateId: '77',
        contentType: 'application/pdf',
        fileName: 'Маълумот ʻ.pdf',
        base64: 'YWJj',
      },
    ]);
  });

  it('multer chegarasi — 413 FILE_TOO_LARGE; boshqa xato o‘zgarmaydi', async () => {
    const run = (error: Error) =>
      lastValueFrom(
        new FileTooLargeInterceptor().intercept({} as never, {
          handle: () => throwError(() => error),
        }),
      );
    await expect(run(new PayloadTooLargeException())).rejects.toMatchObject({
      response: { errorCode: 'FILE_TOO_LARGE' },
    });
    const other = new BadRequestException('x');
    await expect(run(other)).rejects.toBe(other);
  });

  it('o‘z hujjati: ID tokendan; keshlanmaydi, inline, kirill nom header’da kodlangan', async () => {
    const { calls, c } = make({
      'finance.self-employed.document-mine': FILE,
      'file.private.get': {
        contentType: 'application/pdf',
        base64: Buffer.from('%PDF-1.7').toString('base64'),
      },
    });
    const headers: Record<string, string> = {};
    const file = await c.document(user, {
      setHeader: (k: string, v: string) => (headers[k] = v),
    } as never);
    expect(calls[0]).toEqual([
      'finance.self-employed.document-mine',
      { affiliateId: '77' },
    ]);
    expect(file).toBeInstanceOf(StreamableFile);
    const h = file.getHeaders();
    expect(h.type).toBe('application/pdf');
    expect(h.disposition).toMatch(/^inline; filename\*=UTF-8''[!-~]+$/);
    expect(h.disposition).not.toContain('(');
    expect(headers['Cache-Control']).toBe('private, no-store');
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
  });
});

describe('BE-25 5-tur: ism-familiya o‘zgarishi (gateway)', () => {
  const dto = { firstName: 'Sevara', lastName: 'Karimova' };
  const make = (answers: Record<string, unknown>) => {
    const calls: Array<[string, unknown]> = [];
    const client = rpc(answers, calls);
    return { calls, c: new AffiliateProfileController(client, client) };
  };

  it('avval moliya (qayta tekshiruv), keyin ism', async () => {
    const { calls, c } = make({
      'identity.affiliate.profile.update': { id: '77' },
      'finance.self-employed.current': INFO,
    });
    expect((await c.update(user, dto)).selfEmployed).toBe(INFO);
    expect(calls.map(([cmd]) => cmd)).toEqual([
      'finance.self-employed.rename',
      'identity.affiliate.profile.update',
      'finance.self-employed.current',
    ]);
    expect(calls[0][1]).toEqual({
      affiliateId: '77',
      fullName: 'Sevara Karimova',
    });
  });

  it('moliya javob bermasa ism ham o‘zgarmaydi', async () => {
    const { calls, c } = make({
      'finance.self-employed.rename': new GatewayTimeoutException(),
    });
    await expect(c.update(user, dto)).rejects.toMatchObject({ status: 504 });
    expect(calls).toHaveLength(1);
  });

  it('profil: moliya javob bermasa maqomsiz qaytadi', async () => {
    const { c } = make({
      'identity.affiliate.profile.get': { id: '77' },
      'finance.self-employed.current': new GatewayTimeoutException(),
    });
    expect(await c.profile(user)).toEqual({ id: '77', card: null });
  });
});

describe('BE-25 5-tur: moliya tekshiruvi (gateway)', () => {
  const make = (answers: Record<string, unknown> = {}) => {
    const calls: Array<[string, unknown]> = [];
    const client = rpc(
      {
        'finance.self-employed.get': { id: '12', affiliateId: '77' },
        'finance.self-employed.approve': {
          id: '12',
          affiliateId: '77',
          status: 'VERIFIED',
        },
        'finance.self-employed.reveal': { pinfl: PINFL },
        'finance.self-employed.document': FILE,
        'identity.affiliate.profile.get': {
          firstName: 'Sevara',
          lastName: 'Yusupova',
        },
        ...answers,
      },
      calls,
    );
    return {
      calls,
      c: new AdminSelfEmployedController(client, client, client),
    };
  };
  const res = { setHeader: jest.fn() } as never;

  it('rollar: ko‘rish — ADMIN ham; raqam, hujjat va qaror — FINANCE, SUPERADMIN', () => {
    const roles = (m: keyof AdminSelfEmployedController) =>
      Reflect.getMetadata(ROLES_KEY, AdminSelfEmployedController.prototype[m]);
    for (const m of ['list', 'get'] as const)
      expect(roles(m)).toEqual([Role.ADMIN, Role.FINANCE, Role.SUPERADMIN]);
    for (const m of [
      'reveal',
      'document',
      'approve',
      'reject',
      'revoke',
    ] as const)
      expect(roles(m)).toEqual([Role.FINANCE, Role.SUPERADMIN]);
    expect(
      Reflect.getMetadata(ROLES_KEY, AffiliateSelfEmployedController),
    ).toEqual([Role.AFFILIATE]);
  });

  it('to‘liq raqam va hujjat: avval audit; audit yozilmasa 503 va ochilmaydi', async () => {
    const ok = make();
    expect(await ok.c.reveal('12', finance7, '', res)).toEqual({
      pinfl: PINFL,
    });
    expect(ok.calls.map(([cmd]) => cmd)).toEqual([
      'identity.audit.log',
      'finance.self-employed.reveal',
    ]);
    expect(JSON.stringify(ok.calls[0][1])).not.toContain(PINFL);
    const down = make({ 'identity.audit.log': new GatewayTimeoutException() });
    await expect(down.c.reveal('12', finance7, '', res)).rejects.toMatchObject({
      status: 503,
    });
    await expect(
      down.c.document('12', finance7, '', res),
    ).rejects.toMatchObject({ status: 503 });
    const opened = down.calls.map(([cmd]) => cmd);
    expect(opened).not.toContain('finance.self-employed.reveal');
    expect(opened).not.toContain('file.private.get');
  });

  it('tasdiq: hozirgi ism identity dan, xodim tokendan', async () => {
    const { calls, c } = make();
    await c.approve('12', finance7, '');
    expect(calls[2]).toEqual([
      'finance.self-employed.approve',
      { id: '12', reviewerId: '7', currentFullName: 'Sevara Yusupova' },
    ]);
  });

  it('rad: sabab va izoh', async () => {
    const { calls, c } = make();
    await c.reject(
      '12',
      { reason: SelfEmployedReason.NAME_MISMATCH, comment: 'x' },
      finance7,
      '',
    );
    expect(calls[0]).toEqual([
      'finance.self-employed.reject',
      { id: '12', reviewerId: '7', reason: 'NAME_MISMATCH', comment: 'x' },
    ]);
  });
});
