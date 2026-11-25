import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GatewayTimeoutException,
  HttpException,
  InternalServerErrorException,
  PayloadTooLargeException,
  ServiceUnavailableException,
  StreamableFile,
} from '@nestjs/common';
import { lastValueFrom, of, throwError } from 'rxjs';
import {
  openPinfl,
  Role,
  ROLES_KEY,
  sealPinfl,
  SelfEmployedReason,
} from '@app/common';
import { AdminSelfEmployedController } from '../withdrawals/admin-self-employed.controller';
import { AffiliateProfileController } from './affiliate-profile.controller';
import {
  AffiliateSelfEmployedController,
  FileTooLargeInterceptor,
} from './affiliate-self-employed.controller';

const PINFL = '30101195600018';
const KEY = 'test-self-employed-key-32-characters!!';
const config = (key: string | undefined = KEY) =>
  ({
    get: (name: string) =>
      name === 'SELF_EMPLOYED_SECRET_KEY' ? key : undefined,
  }) as never;
const user = { sub: '77', role: Role.AFFILIATE } as never;
const finance7 = { sub: '7', role: Role.FINANCE } as never;
const FILE = {
  objectKey: 'private/affiliate/77/0f0e8f3a-1b2c-4d5e-8f90-a1b2c3d4e5f6.pdf',
  fileName: 'Маълумот (1).pdf',
  contentType: 'application/pdf',
  size: 12,
};
const INFO = { status: 'PENDING', pinflLast4: '0018' };
const SUBMITTED = { id: '12', info: INFO };

/** RPC stub: buyruq → javob (yoki xato); chaqiruvlar tartibi `calls` da. */
function rpc(
  answers: Record<string, unknown>,
  calls: Array<[string, unknown]>,
) {
  return {
    send: jest.fn(({ cmd }: { cmd: string }, data: unknown) => {
      calls.push([cmd, data]);
      const a = answers[cmd];
      // servis xatosi RMQ dan shu shaklda keladi (RpcHttpExceptionFilter)
      if (a instanceof HttpException) {
        const body = a.getResponse() as { errorCode?: string };
        return throwError(() => ({
          statusCode: a.getStatus(),
          message: a.message,
          errorCode: body.errorCode,
        }));
      }
      return of(a ?? { ok: true });
    }),
  } as never;
}

describe('BE-25 5-tur: sotuvchi JShShIR arizasi (gateway)', () => {
  const make = (answers: Record<string, unknown> = {}, key?: string) => {
    const calls: Array<[string, unknown]> = [];
    const client = rpc(
      {
        'identity.affiliate.profile.get': {
          firstName: ' Sevara ',
          lastName: 'Yusupova',
        },
        'finance.self-employed.submit': SUBMITTED,
        'file.affiliate-document.commit': FILE,
        ...answers,
      },
      calls,
    );
    return {
      calls,
      c: new AffiliateSelfEmployedController(
        client,
        client,
        client,
        config(key),
      ),
    };
  };
  const flush = () => new Promise((r) => setImmediate(r));

  it('yuborish: ID tokendan, ism profildan; auditda to‘liq JShShIR yo‘q', async () => {
    const { calls, c } = make();
    expect(await c.submit({ pinfl: ` ${PINFL} ` }, user, '1.2.3.4')).toBe(INFO);
    await flush();
    expect(calls.map(([cmd]) => cmd)).toEqual([
      'identity.affiliate.profile.get',
      'finance.self-employed.check',
      'finance.self-employed.submit',
      'identity.audit.log',
    ]);
    const sent = calls[2][1] as { pinflSealed: string };
    expect(sent).toMatchObject({
      affiliateId: '77',
      fullName: 'Sevara Yusupova',
      document: null,
    });
    // servislararo xabarda ham ochiq raqam yo‘q
    expect(JSON.stringify(calls)).not.toContain(PINFL);
    expect(openPinfl(sent.pinflSealed, KEY)).toBe(PINFL);
    expect(calls[3][1]).toMatchObject({
      entityId: '12',
      meta: { affiliateId: '77', pinflLast4: '0018' },
    });
  });

  it('JShShIR 14 raqam emas — PINFL_INVALID, hech qanday chaqiruv yo‘q', async () => {
    const { calls, c } = make();
    for (const pinfl of ['', '123', `${PINFL}1`, 'abcdefghijklmn'])
      await expect(c.submit({ pinfl }, user, '')).rejects.toMatchObject({
        response: { errorCode: 'PINFL_INVALID' },
      });
    expect(calls).toEqual([]);
  });

  it('kalit yo‘q — 503, hech narsa yuborilmaydi; tekshiruv rad etsa fayl ko‘chirilmaydi', async () => {
    const off = make({}, '');
    await expect(
      off.c.submit({ pinfl: PINFL, documentId: 'd.pdf' }, user, ''),
    ).rejects.toMatchObject({ status: 503 });
    expect(off.calls).toEqual([]);
    const pending = make({
      'finance.self-employed.check': new ConflictException({
        message: 'x',
        errorCode: 'ALREADY_PENDING',
      }),
    });
    await expect(
      pending.c.submit({ pinfl: PINFL, documentId: 'd.pdf' }, user, ''),
    ).rejects.toMatchObject({ response: { errorCode: 'ALREADY_PENDING' } });
    expect(pending.calls.map(([cmd]) => cmd)).not.toContain(
      'file.affiliate-document.commit',
    );
  });

  it('superadmin «nomidan ko‘rish» rejimida: yuklash, yuborish va hujjat — 403', async () => {
    const { calls, c } = make();
    const as = { ...(user as object), impersonatedBy: '1' } as never;
    expect(() => c.uploadDocument({ size: 1 } as never, as)).toThrow(
      ForbiddenException,
    );
    await expect(c.submit({ pinfl: PINFL }, as, '')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(c.document(as, {} as never)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
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
    for (const [error, status, removed] of [
      [new GatewayTimeoutException(), 504, false],
      [new InternalServerErrorException(), 500, false],
      [new ServiceUnavailableException(), 503, true],
    ] as const) {
      const other = make({ 'finance.self-employed.submit': error });
      await expect(other.c.submit(dto, user, '')).rejects.toMatchObject({
        status,
      });
      await flush();
      expect(
        other.calls.some(([cmd]) => cmd === 'file.affiliate-document.remove'),
      ).toBe(removed);
    }
    const commit = rejected.calls.find(
      ([cmd]) => cmd === 'file.affiliate-document.commit',
    )![1] as { deadline: number };
    expect(commit.deadline - Date.now()).toBeGreaterThan(0);
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
    expect(calls[0][0]).toBe('file.affiliate-document.store');
    expect(calls[0][1]).toMatchObject({
      data: { affiliateId: '77', fileName: 'Маълумот ʻ.pdf', base64: 'YWJj' },
      // hujjat navbatda diskka yozilmaydi
      options: { persistent: false },
    });
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
      'finance.self-employed.rename': { recheck: true, info: INFO },
    });
    expect(await c.update(user, dto, '')).toEqual({
      id: '77',
      selfEmployed: INFO,
      card: null,
    });
    expect(calls.map(([cmd]) => cmd)).toEqual([
      'finance.self-employed.rename',
      'identity.audit.log',
      'identity.affiliate.profile.update',
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
    await expect(c.update(user, dto, '')).rejects.toMatchObject({
      status: 504,
    });
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
        'finance.self-employed.reveal': { pinflSealed: sealPinfl(PINFL, KEY) },
        'finance.self-employed.document': FILE,
        'finance.self-employed.rename': { recheck: true, info: INFO },
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
      c: new AdminSelfEmployedController(client, client, client, config()),
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
      'finance.self-employed.get',
      'identity.audit.log',
      'finance.self-employed.reveal',
    ]);
    expect(ok.calls[1][1]).toMatchObject({
      entityId: '12',
      meta: { affiliateId: '77' },
    });
    expect(JSON.stringify(ok.calls)).not.toContain(PINFL);
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

  it('shifr kaliti almashgan — 409, 500 emas', async () => {
    const { c } = make({
      'finance.self-employed.reveal': {
        pinflSealed: sealPinfl(PINFL, `${KEY}-eski`),
      },
    });
    await expect(c.reveal('12', finance7, '', res)).rejects.toMatchObject({
      status: 409,
    });
  });

  it('ism arizadagidan farq qilsa: ariza hozirgi ism bilan yangilanadi (tiqilib qolmaydi), 409', async () => {
    const { calls, c } = make({
      'finance.self-employed.approve': new ConflictException({
        message: 'x',
        errorCode: 'NAME_CHANGED',
      }),
    });
    await expect(c.approve('12', finance7, '')).rejects.toMatchObject({
      response: { errorCode: 'NAME_CHANGED' },
    });
    expect(calls.slice(-2)).toEqual([
      [
        'finance.self-employed.rename',
        { affiliateId: '77', fullName: 'Sevara Yusupova' },
      ],
      [
        'identity.audit.log',
        expect.objectContaining({
          actorId: '7',
          action: 'self-employed.recheck',
        }),
      ],
    ]);
    const other = make({
      'finance.self-employed.approve': new ConflictException('x'),
    });
    await expect(other.c.approve('12', finance7, '')).rejects.toMatchObject({
      status: 409,
    });
    expect(other.calls.map(([cmd]) => cmd)).not.toContain(
      'finance.self-employed.rename',
    );
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
