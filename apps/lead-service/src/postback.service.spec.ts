import { AffiliatePostbackEvent } from '@app/common';
import { buildPostbackUrl, postbackRetryAt } from './postback.service';

describe('Postback (BE-14)', () => {
  const lead = {
    id: '7001',
    clickId: '90311',
    productId: '501',
    sub1: 'kampaniya 1',
    sub2: null,
    sub3: null,
    sub4: null,
    sub5: null,
  };

  it('makrolar almashtiriladi va kodlanadi; noma’lumi qoladi; variant yo‘q', () => {
    expect(
      buildPostbackUrl(
        'https://t.example.com/pb?s={status}&l={lead_id}&c={click_id}&p={product_id}&a={sub1}&b={sub2}&x={variant}',
        lead,
        AffiliatePostbackEvent.CONFIRMED,
      ),
    ).toBe(
      'https://t.example.com/pb?s=confirmed&l=7001&c=90311&p=501&a=kampaniya%201&b=&x={variant}',
    );
  });

  it('qayta urinish: 1, 2, 4, 8 daqiqa (notification-service namunasi)', () => {
    const now = new Date('2026-12-10T10:00:00.000Z');
    expect(
      [1, 2, 3, 4].map(
        (n) => (postbackRetryAt(n, now).getTime() - now.getTime()) / 60_000,
      ),
    ).toEqual([1, 2, 4, 8]);
  });
});
