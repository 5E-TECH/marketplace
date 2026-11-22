import { ConfigService } from '@nestjs/config';
import { SiteOrderSmsController } from './site-order-sms.controller';

describe('SiteOrderSmsController (BE-34)', () => {
  const event = (over: Record<string, unknown> = {}) =>
    ({
      eventId: 'e1',
      leadId: '7001',
      phone: '+998901234567',
      text: 'Elchi Market: buyurtma 541 000 so‘m. Tasdiqlash: https://elchimarket.uz/buyurtma/tasdiq/abc',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      ...over,
    }) as never;
  const make = (configured: boolean, env = 'production') => {
    const sms = {
      isConfigured: jest.fn(() => configured),
      send: jest.fn(async () => undefined),
    };
    return {
      sms,
      controller: new SiteOrderSmsController(
        sms as never,
        new ConfigService({ NODE_ENV: env }),
      ),
    };
  };

  it('SMS adapteri orqali mijoz telefoniga yuboradi', async () => {
    const { sms, controller } = make(true);
    await controller.send(event());
    expect(sms.send).toHaveBeenCalledWith({
      recipient: '+998901234567',
      title: 'Elchi Market',
      body: expect.stringContaining('Tasdiqlash: https://'),
    });
  });

  it('muddati o‘tgan havola, noto‘g‘ri telefon yoki sozlanmagan provayder — yuborilmaydi', async () => {
    const { sms, controller } = make(true);
    await controller.send(
      event({ expiresAt: new Date(Date.now() - 1).toISOString() }),
    );
    await controller.send(event({ phone: '901234567' }));
    expect(sms.send).not.toHaveBeenCalled();
    const off = make(false);
    await off.controller.send(event());
    expect(off.sms.send).not.toHaveBeenCalled();
  });

  it('provayder xatosi qayta tashlanadi (RMQ jurnali va DLQ)', async () => {
    const { sms, controller } = make(true);
    sms.send.mockRejectedValueOnce(new Error('SMS provider HTTP 503'));
    await expect(controller.send(event())).rejects.toThrow('503');
  });
});
