import { redactUrl } from './redact-url';

describe('redactUrl (BE-15, BE-30)', () => {
  it('imzolangan havola tokeni yashiriladi, boshqa yo‘llar o‘zgarmaydi', () => {
    expect(redactUrl('/api/v1/call-recordings/abc.def')).toBe(
      '/api/v1/call-recordings/[havola]',
    );
    expect(redactUrl('/api/v1/signed-files/abc.def?x=1')).toBe(
      '/api/v1/signed-files/[havola]?x=1',
    );
    expect(redactUrl('/api/v1/calls/501/recording-link')).toBe(
      '/api/v1/calls/501/recording-link',
    );
    expect(redactUrl(undefined)).toBeUndefined();
  });
});
