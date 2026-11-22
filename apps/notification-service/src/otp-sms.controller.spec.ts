import { Logger } from '@nestjs/common';
import { OtpSmsController } from './otp-sms.controller';

describe('BE-06 TC4: SMS kod hodisasi notification-service ga yetadi', () => {
  const event = { phone: '+998901234567', code: '305918', purpose: 'REGISTER' };
  const config = (env: Record<string, string>) =>
    ({ get: (key: string) => env[key] }) as never;
  let warn: jest.SpyInstance;
  let error: jest.SpyInstance;

  beforeEach(() => {
    warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    error = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('SMS adapteri sozlangan — kod SMS bilan yuboriladi (bazaga yozilmaydi)', async () => {
    const sms = {
      isConfigured: () => true,
      send: jest.fn(async () => undefined),
    };
    await new OtpSmsController(sms as never, config({})).onCode(event);
    expect(sms.send).toHaveBeenCalledWith({
      recipient: '+998901234567',
      title: 'Elchi',
      body: '305918 — ro‘yxatdan o‘tish kodi. 5 daqiqa amal qiladi. Kodni hech kimga aytmang.',
    });
  });

  it('test stub: adapter sozlanmagan, prod emas — kod logda ko‘rinadi', async () => {
    const sms = { isConfigured: () => false, send: jest.fn() };
    await new OtpSmsController(
      sms as never,
      config({ NODE_ENV: 'test' }),
    ).onCode(event);
    expect(sms.send).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('305918'));
  });

  it('prod’da adapter sozlanmagan — kod logga chiqmaydi, xato logi; noto‘g‘ri hodisa tashlanadi', async () => {
    const sms = { isConfigured: () => false, send: jest.fn() };
    await new OtpSmsController(
      sms as never,
      config({ NODE_ENV: 'production' }),
    ).onCode(event);
    expect(error).toHaveBeenCalledWith(expect.not.stringContaining('305918'));
    expect(warn).not.toHaveBeenCalled();
    await new OtpSmsController(sms as never, config({})).onCode({
      ...event,
      code: '12',
    });
    expect(sms.send).not.toHaveBeenCalled();
  });

  it('BE-24 TC5: provayder javob bermasa — 15 s va 60 s dan keyin qayta (kod yo‘qolmaydi)', async () => {
    jest.useFakeTimers();
    try {
      const sms = {
        isConfigured: () => true,
        send: jest
          .fn()
          .mockRejectedValueOnce(new Error('HTTP 503'))
          .mockRejectedValueOnce(new Error('HTTP 503'))
          .mockResolvedValue(undefined),
      };
      await new OtpSmsController(sms as never, config({})).onCode(event);
      expect(sms.send).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(15_000);
      expect(sms.send).toHaveBeenCalledTimes(2);
      await jest.advanceTimersByTimeAsync(60_000);
      expect(sms.send).toHaveBeenCalledTimes(3);
      expect(sms.send).toHaveBeenLastCalledWith(
        expect.objectContaining({ body: expect.stringContaining('305918') }),
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('provayder xato bersa — xato logi, hodisa yiqilmaydi', async () => {
    const sms = {
      isConfigured: () => true,
      send: jest.fn(async () => {
        throw new Error('HTTP 500');
      }),
    };
    await expect(
      new OtpSmsController(sms as never, config({})).onCode(event),
    ).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith(expect.stringContaining('HTTP 500'));
  });

  it('BE-24: yangi kod kelsa eski kodning qayta urinishi bekor (faqat eng yangi kod yuboriladi)', async () => {
    jest.useFakeTimers();
    try {
      const sms = {
        isConfigured: () => true,
        send: jest
          .fn()
          .mockRejectedValueOnce(new Error('HTTP 503'))
          .mockResolvedValue(undefined),
      };
      const ctrl = new OtpSmsController(sms as never, config({}));
      await ctrl.onCode(event); // 305918 — xato, 15 s dan keyin qayta
      await ctrl.onCode({ ...event, code: '777111' }); // yangi kod
      await jest.advanceTimersByTimeAsync(120_000);
      expect(sms.send.mock.calls.map((c) => c[0].body.slice(0, 6))).toEqual([
        '305918',
        '777111',
      ]);
    } finally {
      jest.useRealTimers();
    }
  });
});
