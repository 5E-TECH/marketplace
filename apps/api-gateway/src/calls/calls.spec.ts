import { ConfigService } from '@nestjs/config';
import { EventEmitter } from 'events';
import { createServer, Server } from 'http';
import { AddressInfo } from 'net';
import { of, throwError } from 'rxjs';
import { Writable } from 'stream';
import {
  CALL_RPC,
  IDENTITY_USER_NAMES,
  RecordingMode,
  Role,
  ROLES_KEY,
} from '@app/common';
import { AdminOperatorPhoneController } from './admin-operator-phone.controller';
import { CallRecordingsController } from './call-recordings.controller';
import { CallsController } from './calls.controller';
import { RecordingLinkService } from './recording-link';

const config = (over: Record<string, unknown> = {}) =>
  new ConfigService({ JWT_SECRET: 'jwt-secret-for-tests-1', ...over });
const user = (role: Role, sub = '41') => ({ sub, role }) as never;
const target = { callId: '501', leadId: '7001', operatorId: '41' };

describe('RecordingLinkService (BE-15, TEL-7)', () => {
  const links = new RecordingLinkService(config());

  it('havola: to‘g‘ri — ochiladi, buzilgan, muddati o‘tgan yoki boshqa kalit — yo‘q', () => {
    const now = Date.now();
    const link = links.sign({ callId: '501', mode: RecordingMode.LISTEN }, now);
    const token = link.url.split('/').at(-1)!;
    expect(link.url).toMatch(/^\/api\/v1\/call-recordings\//);
    expect(links.verify(token, now)).toEqual({
      callId: '501',
      mode: RecordingMode.LISTEN,
    });
    const [payload, mac] = token.split('.');
    const forged = Buffer.from(
      JSON.stringify({ c: '502', d: true, e: Math.floor(now / 1000) + 600 }),
    ).toString('base64url');
    for (const bad of [
      '',
      payload,
      `${payload}.`,
      `${forged}.${mac}`,
      `${token}.x`,
      token.slice(0, -1),
    ])
      expect(links.verify(bad, now)).toBeNull();
    expect(links.verify(token, new Date(link.expiresAt).getTime())).toBeNull();
    expect(
      new RecordingLinkService(
        config({ FILE_LINK_SECRET: 'boshqa-kalit' }),
      ).verify(token, now),
    ).toBeNull();
    const download = links.sign({
      callId: '501',
      mode: RecordingMode.DOWNLOAD,
    });
    expect(links.verify(download.url.split('/').at(-1)!)?.mode).toBe(
      RecordingMode.DOWNLOAD,
    );
  });
});

describe('CallsController: tinglash va audit (TC4)', () => {
  const setup = (access: unknown, audit: jest.Mock = jest.fn(() => of({}))) => {
    const lead = jest.fn(() => of(access));
    const controller = new CallsController(
      { send: lead } as never,
      { send: audit } as never,
      new RecordingLinkService(config()),
    );
    return { controller, lead, audit };
  };

  it('rollar: hisobot — nazoratchi, admin, superadmin; havola — operator ham', () => {
    const roles = (name: 'list' | 'recordingLink') =>
      Reflect.getMetadata(ROLES_KEY, CallsController.prototype[name]);
    expect(roles('list')).toEqual([
      Role.SUPERVISOR,
      Role.ADMIN,
      Role.SUPERADMIN,
    ]);
    expect(roles('recordingLink')).toEqual([
      Role.OPERATOR_LEAD,
      Role.SUPERVISOR,
      Role.ADMIN,
      Role.SUPERADMIN,
    ]);
  });

  it.each([
    [RecordingMode.LISTEN, 'call.recording.listen'],
    [RecordingMode.DOWNLOAD, 'call.recording.download'],
  ])('%s — audit `%s` va havola', async (mode, action) => {
    const { controller, lead, audit } = setup({ allowed: true, ...target });
    const link = await controller.recordingLink(
      '501',
      { mode },
      user(Role.ADMIN, '3'),
      '1.2.3.4',
    );
    expect(link.url).toContain('/call-recordings/');
    expect(lead).toHaveBeenCalledWith(
      { cmd: CALL_RPC.RECORDING_ACCESS },
      { callId: '501', userId: '3', role: Role.ADMIN, mode },
    );
    expect(audit).toHaveBeenCalledWith(
      { cmd: 'identity.audit.log' },
      {
        actorId: '3',
        action,
        entityType: 'Call',
        entityId: '501',
        meta: {
          leadId: '7001',
          operatorId: '41',
          role: Role.ADMIN,
          ip: '1.2.3.4',
        },
      },
    );
  });

  it('TC4: boshqa operator yozuvi → 403 va audit yozuvi', async () => {
    const { controller, audit } = setup({
      allowed: false,
      reason: 'NOT_OWNER',
      ...target,
    });
    await expect(
      controller.recordingLink(
        '501',
        {},
        user(Role.OPERATOR_LEAD, '42'),
        '::1',
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(audit).toHaveBeenCalledWith(
      { cmd: 'identity.audit.log' },
      expect.objectContaining({
        actorId: '42',
        action: 'call.recording.denied',
        meta: expect.objectContaining({
          reason: 'NOT_OWNER',
          operatorId: '41',
          mode: RecordingMode.LISTEN,
        }),
      }),
    );
  });

  it('audit yozilmasa havola berilmaydi (503); rad bo‘lsa baribir 403', async () => {
    const down = jest.fn(() => throwError(() => new Error('identity yo‘q')));
    const allowed = setup({ allowed: true, ...target }, down);
    await expect(
      allowed.controller.recordingLink('501', {}, user(Role.SUPERVISOR), ''),
    ).rejects.toMatchObject({ status: 503 });
    const denied = setup(
      { allowed: false, reason: 'DOWNLOAD_FORBIDDEN', ...target },
      down,
    );
    await expect(
      denied.controller.recordingLink(
        '501',
        { mode: RecordingMode.DOWNLOAD },
        user(Role.SUPERVISOR),
        '',
      ),
    ).rejects.toMatchObject({ status: 403 });
  });
});

describe('CallRecordingsController: yozuv oqimi', () => {
  const AUDIO = Buffer.from('0123456789');
  let server: Server;
  let url: string;
  let reply: 'audio' | 'html' | 'missing' | 'error' | 'redirect' = 'audio';
  const seen: Array<{ path?: string; auth?: string; range?: string }> = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      seen.push({
        path: req.url,
        auth: req.headers.authorization,
        range: req.headers.range,
      });
      if (reply === 'missing') return void res.writeHead(404).end();
      if (reply === 'error') return void res.writeHead(500).end('x');
      if (reply === 'redirect')
        return void res
          .writeHead(302, { location: 'http://169.254.169.254/' })
          .end();
      if (reply === 'html')
        return void res
          .writeHead(200, { 'content-type': 'text/html' })
          .end('<script>');
      if (req.headers.range === 'bytes=2-4')
        return void res
          .writeHead(206, {
            'content-type': 'audio/mpeg',
            'content-range': 'bytes 2-4/10',
            'content-length': 3,
          })
          .end(AUDIO.subarray(2, 5));
      res
        .writeHead(200, {
          'content-type': 'audio/mpeg; charset=binary',
          'content-length': AUDIO.length,
          'accept-ranges': 'bytes',
          'set-cookie': 'provider=1',
        })
        .end(AUDIO);
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  });
  afterAll(async () => {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  });
  beforeEach(() => {
    reply = 'audio';
    seen.length = 0;
  });

  const links = new RecordingLinkService(config());
  const get = async (
    token: string,
    range?: string,
    over: Record<string, unknown> = {},
  ) => {
    const send = jest.fn(() => of({ recordingRef: 'rec/../5521?x' }));
    const controller = new CallRecordingsController(
      { send } as never,
      links,
      config({
        TELEPHONY_API_URL: url,
        TELEPHONY_API_TOKEN: 'provider-token',
        ...over,
      }),
    );
    const chunks: Buffer[] = [];
    const headers: Record<string, string> = {};
    const res = Object.assign(
      new Writable({
        write(chunk: Buffer, _e, done) {
          chunks.push(chunk);
          done();
        },
      }),
      {
        code: 200,
        status(code: number) {
          this.code = code;
          return this;
        },
        setHeader(name: string, value: unknown) {
          headers[name.toLowerCase()] = String(value);
        },
      },
    );
    await controller.stream(
      token,
      range,
      new EventEmitter() as never,
      res as never,
    );
    return { send, body: Buffer.concat(chunks).toString(), headers, res };
  };
  const token = (mode = RecordingMode.LISTEN) =>
    links.sign({ callId: '501', mode }).url.split('/').at(-1)!;

  it('to‘liq yozuv: provayder kaliti serverda, yo‘l kodlangan, keshsiz; provayder cookie si uzatilmaydi', async () => {
    const { body, headers, res, send } = await get(token());
    expect(body).toBe('0123456789');
    expect(res.code).toBe(200);
    expect(send).toHaveBeenCalledWith(
      { cmd: CALL_RPC.RECORDING_REF },
      { callId: '501' },
    );
    expect(seen).toEqual([
      {
        path: '/recordings/rec%2F..%2F5521%3Fx',
        auth: 'Bearer provider-token',
        range: undefined,
      },
    ]);
    expect(headers).toMatchObject({
      'content-type': 'audio/mpeg',
      'content-length': '10',
      'accept-ranges': 'bytes',
      'cache-control': 'private, no-store',
      'content-disposition': 'inline; filename="qongiroq-501.mp3"',
    });
    expect(headers['set-cookie']).toBeUndefined();
  });

  it('`Range` — 206; noto‘g‘ri `Range` uzatilmaydi; yuklab olish — attachment', async () => {
    const part = await get(token(), 'bytes=2-4');
    expect(part.res.code).toBe(206);
    expect(part.body).toBe('234');
    expect(part.headers['content-range']).toBe('bytes 2-4/10');
    await get(token(), 'bytes=0-1,5-6');
    expect(seen.at(-1)!.range).toBeUndefined();
    const file = await get(token(RecordingMode.DOWNLOAD));
    expect(file.headers['content-disposition']).toBe(
      'attachment; filename="qongiroq-501.mp3"',
    );
  });

  it('havola yaroqsiz — 403; provayderda yo‘q — 404; xato, audio emas, yo‘naltirish — 502; ulanmagan — 503', async () => {
    await expect(get('x.y')).rejects.toMatchObject({ status: 403 });
    expect(seen).toEqual([]);
    for (const [mode, status] of [
      ['missing', 404],
      ['error', 502],
      ['html', 502],
      ['redirect', 502],
    ] as const) {
      reply = mode;
      await expect(get(token())).rejects.toMatchObject({ status });
    }
    await expect(
      get(token(), undefined, { TELEPHONY_API_URL: '' }),
    ).rejects.toMatchObject({ status: 503 });
  });
});

describe('AdminOperatorPhoneController', () => {
  const setup = (names: unknown[], phone: unknown = null) => {
    const lead = jest.fn((pattern: { cmd: string }) =>
      of(
        pattern.cmd === CALL_RPC.PHONE_SET
          ? { operatorId: '41', kind: 'EXTENSION', value: '101' }
          : pattern.cmd === CALL_RPC.PHONE_DELETE
            ? { deleted: true }
            : phone,
      ),
    );
    const identity = jest.fn((pattern: { cmd: string }) =>
      of(pattern.cmd === IDENTITY_USER_NAMES ? names : {}),
    );
    return {
      controller: new AdminOperatorPhoneController(
        { send: lead } as never,
        { send: identity } as never,
      ),
      lead,
      identity,
    };
  };
  const dto = { kind: 'EXTENSION', value: '101' } as never;

  it('faqat admin va superadmin; operator yoki nazoratchiga; audit oldin → keyin', async () => {
    expect(
      Reflect.getMetadata(ROLES_KEY, AdminOperatorPhoneController),
    ).toEqual([Role.ADMIN, Role.SUPERADMIN]);
    const { controller, lead, identity } = setup(
      [{ id: '41', name: 'D', role: Role.OPERATOR_LEAD }],
      { kind: 'MOBILE', value: '+998907771122' },
    );
    await controller.set('41', dto, user(Role.ADMIN, '3'), '1.1.1.1');
    expect(lead).toHaveBeenCalledWith(
      { cmd: CALL_RPC.PHONE_SET },
      { operatorId: '41', dto, actorId: '3' },
    );
    expect(identity).toHaveBeenLastCalledWith(
      { cmd: 'identity.audit.log' },
      expect.objectContaining({
        action: 'operator.phone.set',
        entityId: '41',
        meta: {
          before: { kind: 'MOBILE', value: '+998907771122' },
          after: { kind: 'EXTENSION', value: '101' },
          ip: '1.1.1.1',
        },
      }),
    );
  });

  it('sotuvchi yoki mavjud bo‘lmagan foydalanuvchi — 400; telefon yo‘q — 404', async () => {
    for (const names of [[], [{ id: '41', name: 'S', role: Role.AFFILIATE }]]) {
      const { controller, lead } = setup(names);
      await expect(
        controller.set('41', dto, user(Role.ADMIN), ''),
      ).rejects.toMatchObject({ status: 400 });
      expect(lead).not.toHaveBeenCalled();
    }
    await expect(setup([]).controller.get('41')).rejects.toMatchObject({
      status: 404,
    });
  });

  it('o‘chirish auditda', async () => {
    const { controller, identity } = setup([], {
      kind: 'EXTENSION',
      value: '101',
    });
    await expect(
      controller.remove('41', user(Role.SUPERADMIN, '1'), ''),
    ).resolves.toEqual({ deleted: true });
    expect(identity).toHaveBeenCalledWith(
      { cmd: 'identity.audit.log' },
      expect.objectContaining({ action: 'operator.phone.delete' }),
    );
  });
});
